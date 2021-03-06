/*
 * Copyright (c) 2016, Bigsens, LLC
 * ZigBee Service main class, Service Gateway client, pipe routines, zigbee rpc.
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	Q = require('q'),
	log4js = global.log4js,
	log = log4js.getLogger('ZigBeeService'),
	debug = require('debug')('ZigBeeService'),
	znp = require('cc-znp'),
	ZProcessor = require('zigbee-shepherd'),
	util = require('util'),
	net = require('net'),
	Stream = require('stream'),
	P = require('./protocol'),
	ServiceEndpoint = require('./ServiceEndpoint'),
	DeviceManager = require('./DeviceManager'),
	aguid = require('aguid');

var Message = P.Message,
	DeviceState = P.DeviceState,
	DeviceType = P.DeviceType;

var servicePort = 13777;

function ZigBeeService(config) {

	var self = this;
	this.name = 'Bigsens ZNP Service';
	this.version = '0.1';
	this.type = 'zigbee';
	this.guid = guidByData(this.name+this.type+this.version);

	this.shortName = 'bs-zigbee';
	this.workingDir = 'zigbee-service';

	this.config = config || {}

	// Allow messages for other services otherwise only the root service have access
	// * - allowed for all services 
	this._registry = {
		'SERVICE_ANNCE' : '*',
		'SERVICE_READY' : '*',
		'SERVICE_INFO' : '*',
	    'MESSAGE_DISCOVER' : '*',
	    'DEVICE_STATE' : '*',
	    'PERMIT_JOIN' : '*',
	    'DEVICE_READ_ATTRIBUTE' : '*',
	    'DEVICE_LIST' : '*',
	    'DEVICE_GET_INFO_BY_ID' : '*',
	    'DEVICE_GET_EXTENDED_INFO_BY_ID' : '*'
	}

	// Service specific properties
	this.uart = this.config.uart || '/dev/ttyACM0';
	this.baudrate = 115200;
	this.panid = this.config.panid || 0xffff;
	this.pollingInterval = this.config.pollingInterval || 15000; // Increase for production
	this.checkOnlineTimer = null;

	this.exitProcessTimeout = 30000; // Exit from process with error code
	this.resetCount = 0; // If count more than 1, will try to reset the service instance

	this.deviceManager = null;

	this.isReady = false;
	this.zap = null;
	this.nwkInfo = null;

	this.retryTimeout = 5000;
	this.retryTimer = null;

	function connectRetry() {
		if(!self.retryTimer) {
			self.retryTimer = setInterval(function() {
				self.rootConnect(servicePort).then(function() {
					if(!self.isReady) {
						self.start();
					}
					clearInterval(self.retryTimer);
					self.retryTimer = null;
				});
			}, self.retryTimeout);
		}
	}

	this.rootConnect(servicePort).then(this.start.bind(this)).fail(connectRetry.bind(this));
	this.on('closed', function() {
		log.info('ZigBee service disconnected.');
		connectRetry();
	});

}

util.inherits(ZigBeeService, ServiceEndpoint);

ZigBeeService.prototype.info = function() {	
	return {
		guid : this.guid,
		name : this.name,
		type : this.type,
		version : this.version,
		shortName : this.shortName,
		workingDir : this.workingDir
	};
}

ZigBeeService.prototype.getGuid = function() {
	return this.guid;
}

ZigBeeService.prototype.getNwkInfo = function() {
	var nwkInfo = this.zap.controller.getNwkInfo();
	return {
		name : 'Zigbee network information',
		type : 'network.zigbee',
		specData : {
			channel : nwkInfo.channel,
			panId : nwkInfo.panId,
			ieeeAddr : nwkInfo.ieeeAddr,
			nwkAddr : nwkInfo.nwkAddr
		}
	};
}

ZigBeeService.prototype.rootConnect = function(servicePort, callback) {
	var deferred = Q.defer();
	var sock = new net.Socket();
	sock.on('error', function(err) {
		log.error('Reconnect to the root endpoint', err);
		deferred.reject(err);
	});
	sock.on('connect', function() {
		ZigBeeService.super_.call(this, sock, false, this.info());
		var address = this.getAddress();
		log.info('ZigBee service connected %s', address);
		this.serviceAnnounce();
		this.messageRegister(this._registry);
			//.then(this.messageRegister.bind(this, this._registry))
			//.done();
		deferred.resolve();
	}.bind(this));
	sock.connect(servicePort, 'localhost');
	return deferred.promise.nodeify(callback);
}

ZigBeeService.prototype.start = function() {

	var self = this,
		zap = this.zap = new ZProcessor(this.uart, {
		sp: { baudrate: this.baudrate, rtscts: false },
		net: { panId: this.panid, channelList: [ 11 ] }
	});
	zap.on('ready', this.app.bind(this));
	zap.on('permitJoining', function(time) { log.info('Permit join time', time); });
	zap.on('ind', this.indState.bind(this));

	// SoC initialization started
	this.socInit().then(zap.start.bind(zap)).fail(function(err) {
		this.sendMessage(Message.SERVICE_ERROR, _encodeMessage(err));
		log.error('ZigBee initialization', err);
		log.info('Trying a hardware reset');
		return this.socReset('hard');
	}).timeout(this.exitProcessTimeout).catch(function() { process.exit(1); });

}

ZigBeeService.prototype.socInit = function(callback) {
	var deferred = Q.defer();
	znp.on('ready', function() {
	    znp.request('SYS', 'resetReq', { type: 0x01 }, function(err, rsp) {
	    	if(!err) {
	    		znp.close(function(err) {
	    	        if(!err) {
	    	        	deferred.resolve();
	    	        } else deferred.reject(err);
	    	    });
	    	} else deferred.reject(err);
	    });
	});
	znp.init({
	    path: this.uart,
	    options: { baudrate: this.baudrate, rtscts: false }
	}, function(err) {
		if(err) deferred.reject(err);
	});
	return deferred.promise.nodeify(callback);
}

ZigBeeService.prototype.socReset = function(resetType, callback) {
	var zap = this.zap,
		self = this;
	if(!zap) return;
	var deferred = Q.defer();
	zap.reset(resetType).then(function() {
		log.warn('Reset times %s', (++self.resetCount));
   		zap.controller.request('SYS', 'ping', {}, function(err, rsp) {
   			if(!err) {
   				log.info('Ping after resetting', rsp);
   				deferred.resolve();
   			} else { // something wrong pull it up
   				console.log(err);
   				if(resetType == 'soft') {
   					deferred.reject(err);
   				} else {
   					process.exit(1);
   				}
   			}
     	});
	}).fail(function(err) {
		log.error('ZNP resetting', err);
		if(resetType == 'soft') {
			deferred.reject(err);
		} else {
			process.exit(1); // exit from service with error. Try process restart.
		}
    }).done();
	return deferred.promise.nodeify(callback);
}

ZigBeeService.prototype._resetTimer = function(resetType, timeout) {
	var self = this;
	return setTimeout(function() {
	    self.resetCoordinator(resetType);
	}, timeout);
}

var guidByData = function(data) {
	return aguid(data);
}

ZigBeeService.prototype.stop = function() {
	this.isReady = false;
	if(this.checkOnlineTimer) {
		clearInterval(this.checkOnlineTimer);
		this.checkOnlineTimer = null;
	}
	this.zap.stop(function(err) {
	});
}

ZigBeeService.prototype.app = function() {
	var zap = this.zap;

	if(!this.isReady) {
		this.isReady = true;
		this.serviceReady();
		//this.messageRegister(this._registry);
			//.then(this.serviceInfo.bind(this))
			//.then(this.messageRegister.bind(this, this._registry))
			//.done();
		log.info('Network information', this.getNwkInfo());
		log.info('ZigBee service start done!');
	}

	if(this.deviceManager) {
		this.deviceManager.cleanup();
		delete this.deviceManager;
	}
	var deviceManager = this.deviceManager = new DeviceManager(zap);

	/*if(this.checkOnlineTimer) {
		clearInterval(this.checkOnlineTimer);
	}
	this.checkOnlineTimer = setInterval(function() {
		deviceManager.checkOnline();
	}, this.pollingInterval);*/

	// for debug, remove in prod.
	zap.permitJoin(0xff, 'all', function (err) { if(err) console.log(err); });

	setInterval(function() {

		var dev = zap.findDevByAddr('0x00124b00012540a4');
		if(dev) {
			//var ep = dev.getEndpoint(1);
			//if(ep) console.log(ep.dump());
			console.log(JSON.stringify(dev.dump(), null, 2));
		}

		//console.log(zap.list());

		var devices = zap._devbox.exportAllObjs();
		devices.forEach(function(dev) {
			//console.log(fmtJson(dev.dump()));
			console.log('%s status %s type is %j', dev.getIeeeAddr(), dev.status, deviceManager._deviceType(dev));
		});

		/*var d = zap.findDevByAddr('0x00124b0009e7d5f8');
		console.log(fmtJson(d.dump()));
		d = zap.findDevByAddr('0x005043c927305e41');
		console.log('smoke', fmtJson(d.dump()));*/


		/*var dev = zigbeeDevices['0x000d6f000bcb7472'];
		
		if(dev) {
			
			dev.Toggle();

		}*/
		

		/*var devs = zap.list();
		var contr = zap.controller;

		_.forEach(devs, function(dev) {
	        var nwkAddr = dev.nwkAddr,
	        	ieeeAddr = dev.ieeeAddr;

	        contr.request('ZDO', 'nodeDescReq', { dstaddr: nwkAddr, nwkaddrofinterest: nwkAddr }).timeout(10000).then(function (rsp) {
		        // rsp: { srcaddr, status, nwkaddr, logicaltype_cmplxdescavai_userdescavai, ..., manufacturercode, ... }
	        	
	        	
	        	console.log('device %s = %s is online', ieeeAddr, fmtJson(rsp));
	        	
		        return rsp;
		    }).fail(function () {
		    	console.log('device %s is offline', ieeeAddr);
		    }).done();

		});*/

	}, 10000);

}

/*
 * Platform agnostic struct (ver.1)
 * 
 * Device {                                | M | map
 *    name                                 | O | string
 * 	  guid -> GUID                         | M | string
 *    type -> Spec.DeviceType              | M | uint16
 *    attributes : {                       | O | map
 *        name : value -> Spec.Attributes  | O | string : type is relative from attr name
 *        ...                              |   | 
 *    }                                    |   |
 *    methods : {                          | O | map
 *        name : params -> Spec.Methods    | O | string : params map
 *        ...                              |   |
 *    }                                    |   |
 * }
 * 
 */


ZigBeeService.prototype.indState = function(msg) {

    var ieeeAddr,
    	devInfo,
    	deviceType,
    	mapStates = {
    		'devIncoming' : DeviceState.DS_JOIN,
    		'devLeaving' : DeviceState.DS_LEAVE,
    		'devOnline' : DeviceState.DS_ONLINE,
    		'devOffline' : DeviceState.DS_OFFLINE,
    		'devChange' : DeviceState.DS_CHANGE_VALUE
    	},
    	state = mapStates[msg.type] || msg.type;

    if(state == DeviceState.DS_JOIN) {
    	// register device before attributes discovery
    	//console.log(fmtJson(msg.data.dump()));
    	devInfo = this.deviceManager.registerDevice(msg.data);
    	console.log('JOIN =', devInfo);
    	// DEVICE_STATE -> DS_JOIN
    } else if(state == DeviceState.DS_ONLINE) {
    	devInfo = this.deviceManager.updateDevice(msg.data);
    	console.log('ONLINE =', devInfo);
    	// DEVICE_STATE -> DS_ONLINE
    } else if(state == DeviceState.DS_OFFLINE) {
    	devInfo = this.deviceManager.updateDevice(msg.data);
    	console.log('OFFLINE =', devInfo);
    	// DEVICE_STATE -> DS_OFFLINE
    } else if(state == DeviceState.DS_LEAVE) {
    	devInfo = this.deviceManager.unregisterDevice(msg.data);
    	console.log('LEAVE =', devInfo);
    	// DEVICE_STATE -> DS_LEAVE
    } else if(state == DeviceState.DS_CHANGE_VALUE) {
    	devInfo = this.deviceManager.updateDevice(msg.data);
    	console.log(devInfo);

    	/*
    	 *  "type": "devChange",
    	 *  "data": {
    	 *  	"ieeeAddr": "0x005043c91f216c0f",
    	 *  	"data": {
    	 *  		"ssIasZone": {
    	 *  			"attrs": {
    	 *  				"zoneStatus": 32
    	 *  			}
    	 *  		}
    	 *  	}
    	 *  }
    	 */

    	// DEVICE_STATE -> DS_CHANGE_VALUE

    }

    if(devInfo) {
    	this.deviceState({ state: state, device : devInfo });
    }

}


/*
 *  Search ZNP routines.
 */

/*
ZigBeeService.prototype._findZNP = function() {
	UART.list(function (err, ports) {
		ports.forEach(function(port) {
			if(port.comName) { // Check for ZNP.
				this._checkZNP(port.comName);
			}
	  });
	});
}

ZigBeeService.prototype._checkZNP = function(dev, rtscts) {
	var serial = new SerialPort(dev, { baudRate : 115200, rtscts : rtscts } );
	serial.on('open', function() {
		serial.on('data', function(data) {
			// Check data from ZNP.
			serial.close();
			return true;
		});
		serial.write(new Buffer([ 0xfe, 0x0, 0x21, 0x01, 0x20 ]), function() {
			debug('_checkZNP', 'znp ping to uart ', dev);
		});
	});
}
*/

/*
 * Utils
 */

// data packing routines
var _decodeMessage = function(data) {
	return JSON.parse(data);
}

var _encodeMessage = function(data) {
	return JSON.stringify(data);
}

// other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}

module.exports = ZigBeeService;
