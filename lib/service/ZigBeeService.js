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
	ZProcessor = require('zigbee-shepherd'),
	util = require('util'),
	net = require('net'),
	Stream = require('stream'),
	P = require('./protocol'),
	DeviceManager = require('../devices/DeviceManager'),
	aguid = require('aguid');
	//zcl = require('zcl-id');

var Message = P.Message,
	DeviceState = P.DeviceState,
	DeviceType = P.DeviceType;

var servicePort = 13777;

function ZigBeeService(config) {

	this.name = 'Bigsens ZNP Service';
	this.version = '0.1';
	this.type = 'zigbee',
	this.guid = guidByData(this.name+this.type+this.version),
	this.config = config || {}
	this.uart = this.config.uart || '/dev/ttyACM0';
	this.panid = this.config.panid || 0xffff;
	this.pollingInterval = this.config.pollingInterval || 30000;
	this.checkOnlineTimer = null;

	this.exitProcessTimeout = 30000; // Exit from process with error code
	this.resetCount = 0; // If count more than 1, will try to reset the service instance

	this.deviceManager = null;

	this.isReady = false;
	this.zap = null;
	this.nwkInfo = null;

	this.socket = null;

	this.start.bind(this);

}

util.inherits(ZigBeeService, Stream);

ZigBeeService.prototype.info = function() {	
	return {
		guid : this.guid,
		name : this.name,
		type : this.type,
		version : this.version
	};
}

ZigBeeService.prototype.start = function() {

	var self = this;
	
	try {

		if(this.socket) {
			// We already have a connection
			return;
		}

		// Initialize socket for RPC
		this.socket = net.connect(servicePort, function() {
			self.sendMessage(Message.SERVICE_ANNCE, self.info());
		}.bind(this));

		this.socket.on('connect', function() {
			console.log('Service gateway success connection');
			this.coordInit();
		}.bind(this));

		// Listen for errors on this connection
		this.socket.on('error', function(err) {
			debug(err);
		}.bind(this));

		
		// Node warns after 11 listeners have been attached
		this.socket.setMaxListeners(999);

		// Setup the bi-directional pipe between the service and socket.
	    this // If the service class will be overloaded good to add ZigBeeClient class
	    .pipe(this.socket)
	    .pipe(this);

	}

	catch(err) {
		console.error(err);
	}
	
}

ZigBeeService.prototype.coordInit = function() {

	var self = this,
		zap = this.zap = new ZProcessor(this.uart, {
		sp: { baudrate: 115200, rtscts: false },
		net: { panId: this.panid, channelList: [ 11 ] }
	});
	this.deviceManager = new DeviceManager(zap);
	zap.on('ready', this.app.bind(this));
	zap.on('permitJoining', function(time) { log.info('Permit join time', time); });
	zap.on('ind', this.deviceState.bind(this));

	var initSuccess = function() {
		if(!this.isReady) { 
			this.isReady = true;
			this.sendMessage(Message.SERVICE_READY, {});
			var nwkInfo = zap.controller.getNwkInfo();
			log.info('Network information', nwkInfo);
			log.info('ZigBeeService start done!');
			this.sendMessage(Message.SERVICE_INFO, {
				name : 'Zigbee network information',
				type : 'network.zigbee',
				specData : {
					channel : nwkInfo.channel,
					panId : nwkInfo.panId,
					ieeeAddr : nwkInfo.ieeeAddr,
					nwkAddr : nwkInfo.nwkAddr
				}
			});
		}
	}

	// SoC initialization started
	zap.controller.start().then(function() {
		// Preventing a strange bugs when some firmware commands
		// does not works but ZNP initialization was success
		return self.resetCoordinator('soft');
	}).then(function() {return zap.controller.close();})
	.then(function() {return zap.start();}).then(initSuccess.bind(this)).fail(function(err) {
		this.sendMessage(Message.SERVICE_ERROR, _encodeMessage(err));
		log.error('ZigBee initialization', err);
		log.info('Trying a hardware reset');
		return this.resetCoordinator('hard');
	}.bind(this)).then(initSuccess.bind(this)).timeout(this.exitProcessTimeout)
	.catch(function(){process.exit(1);});

}

ZigBeeService.prototype.resetCoordinator = function(resetType, callback) {
	var zap = this.zap,
		self = this;
	if(!zap) return;
	var deferred = Q.defer();
	zap.reset(resetType).then(function() {
		log.warn('Reset times %i', (self.resetCount++));
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
	/*if(this.checkOnlineTimer) {
		clearInterval(this.checkOnlineTimer);
	}
	this.checkOnlineTimer = setInterval(function() {
		zap.checkOnline();
	}, this.pollingInterval);*/

	// for debug, remove in prod.
	zap.permitJoin(0xff, 'all', function (err) { if (err) console.log(err); });

	setInterval(function() {

		/*var dev = zap.findDevByAddr('0x005043c91f214972');
		if(dev) {
			//var ep = dev.getEndpoint(1);
			//if(ep) console.log(ep.dump());
			console.log(JSON.stringify(dev.dump(), null, 2));
		}*/

		console.log(zap.list());

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

ZigBeeService.prototype.deviceState = function(msg) {

	//console.log(fmtJson(msg));

    var ieeeAddr,
    	device,
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
    	if(msg.data) {
    		this.deviceManager.registerDevice(msg.data);	
    	}
    } else if(state == DeviceState.DS_ONLINE) {

    	/*ieeeAddr = msg.data;
    	device = this.zap.findDevByAddr(ieeeAddr);
    	if(device) {
    		this.deviceManager.registerDevice(device);	
    	}*/
    	
    } else if(state == DeviceState.DS_LEAVE) {
    	this.deviceManager.unregisterDevice(msg.data);
    } else if(state == DeviceState.DS_CHANGE_VALUE) {

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
    	
    	

    }


    /*if(state == DeviceState.DS_LEAVE
    		|| state == DeviceState.DS_ONLINE
    		|| state == DeviceState.DS_OFFLINE
    		|| state == DeviceState.DS_CHANGE_VALUE) {
    	device = this.zap.list(msg.data);
    	if(device) {
    		device = device[0];
    		if(state == DeviceState.DS_CHANGE_VALUE && msg.data.data) {
    			device.data = msg.data.data;
    		}
    	}
    } else {
    	device = msg.data;
    }

    this.sendMessage(Message.DEVICE_STATE, { state : state, device : device });*/
}

/*
 * RPC section describes how messages handled from and write to remote service.
 */

/* 
 * Handle incoming message from remote service.
 */

ZigBeeService.prototype.write = function(data) {
	debug('incomingData', 'Processing msg');
	this.processData(data);
}

ZigBeeService.prototype.encodeData = function(data) {
	var encoded = JSON.parse(data); //protoify.parse(data);
	// Print some nice debugging information
	debug('encodeData', data);
	debug("-------------------------------------------------------------------");
	debug('encodeData', JSON.stringify(encoded));
    return encoded;
}

ZigBeeService.prototype.processData = function(msg) {
	var length = msg.length;
	var remainingMessage = msg;
	var used;
	do {
		used = this.receiveMessage(remainingMessage);
		remainingMessage = remainingMessage.slice(used);
	    debug('Read message length ', used, 'of', length, '. ', remainingMessage.length,' remaining.');
	} while (remainingMessage.length && used > 0);
}

ZigBeeService.prototype.receiveMessage = function(data) {

	// Need to add encoder/decoder depended on protocol. Now hard linked with
	// the protobuf protocol.
	var msg = this.encodeData(data);

	var cmd = msg.cmd;
	var data = msg.data;

	log.info('readMessage :', Message.inverted[cmd]);

	// Add SRSP
	if(cmd == Message.SERVICE_INFO) 	{ this.getServiceInfo(); 	}
	if(cmd == Message.DEVICE_LIST) 		{ this.getDevices(); 		}
	if(cmd == Message.PAIRING_MODE) 	{ this.permitJoin(data); 	}
}

/*
 * Send message to remote service.
 */

ZigBeeService.prototype.sendMessage = function(cmd, data, rsp) {
	if(!this.socket) {
		console.error('Service not connected to the Service Gateway.');
		return;
	}
	/*if(!this.isReady) {
		cmd = Message.SERVICE_ERROR;
		data = { message : 'ZigBee service not ready. Try request later.' };
	}*/

	debug('sendMessage', 'message:', Message.inverted[cmd], ', data:', fmtJson(data));

	var packet = { cmd : cmd, data : data };
	packet.rsp = rsp || false;
	var buf = _encodeMessage(packet);
	this.emit('data', buf);
}

/*
 * Methods for RPC
 */

/*
ZigBeeService.prototype.buildDeviceByAddr = function(ieeeAddr) {
	var dev = {};
	var d = this.zap.findDevByAddr(ieeeAddr);
	if(dev) {
		 dev.guid = guidByData(ieeeAddr);
		 dev.id = d.id;
         dev.type = d.type;
         dev.ieeeAddr = ieeeAddr;
         dev.nwkAddr = d.nwkAddr;
         dev.status = d.status;
         dev.joinTime = d.joinTime;
         dev.manufId = d.manufId;
	}
	var attrBasic = this.findAttrsByClusterName(d, 'genBasic');
	if(attrBasic) {
		dev.manufacturerName = attrBasic.manufacturerName;
		dev.modelId = attrBasic.modelId;
		dev.powerSource = attrBasic.powerSource; // 3 - battery source
	}

}
*/

ZigBeeService.prototype.getServiceInfo = function(callback) {
	try {
		this.sendMessage(Message.SERVICE_INFO, this.info());
	}
	catch(err) {
		console.error(err.stack);
	}
}

ZigBeeService.prototype.getDevices = function(callback) {
	var self = this;
	try {
		var devices = this.zap.list();
		devices.forEach(function(dev) {
			//console.log(dev.endpoints);
			//dev.deviceType = self.deviceType(self.zap.findDevByAddr(dev.ieeeAddr));
		});
		this.sendMessage(Message.DEVICE_LIST, { devices: devices }, true);
	}
	catch(err) {
		console.error(err.stack);
	}
}

ZigBeeService.prototype.permitJoin = function(pairingTime) {
	var zap = this.zap;
	pairingTime = Math.min(pairingTime || 60, 255);
	console.log('Entering pairing mode for ' + pairingTime + ' seconds');
	zap.permitJoin(pairingTime, 'all', function (err) {
		// send response to CGS 
		if (err) console.log(err);
		else {
			console.log('Pairing mode is ok.');
		}
	});
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
