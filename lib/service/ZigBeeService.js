/*
 * Copyright (c) 2016, Bigsens, LLC
 * ZigBee Service main class, Service Gateway client, pipe routines, zigbee rpc.
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	log4js = global.log4js,
	log = log4js.getLogger('ZigBeeService'),
	debug = require('debug')('ZigBeeService'),
	ZAP = require('zigbee-shepherd'),
	util = require('util'),
	net = require('net'),
	Stream = require('stream'),
	P = require('./protocol'),
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

	this.resetTimeout = 30000; // Hardware reset if init not finished during that time
	this.resetCount = 0; // If count more than 1, will try to reset the service instance

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

	var zap = this.zap = new ZAP(this.uart, {
		sp: { baudrate: 115200, rtscts: false },
		net: { panId: this.panid, channelList: [ 11 ] }
	});
	zap.on('ready', this.app.bind(this));
	zap.on('permitJoining', function(time) { console.log('PERMIT JOIN: ' + time); });
	zap.on('ind', this.deviceState.bind(this));

	var resetTimer = this._resetTimer('soft', this.resetTimeout);

	// Start zigbee
	zap.start(function (err) {
	    if (err) { // send error to CGS
	        console.error('ZigBeeService start err : ' + err);
	    	this.sendMessage(Message.SERVICE_ERROR, JSON.stringify(err));
	    } else {
	    	this.isReady = true;
	    	this.sendMessage(Message.SERVICE_READY, {}); // Marker. Not good solution.
	    	clearTimeout(resetTimer); // remove reset timer
	    	var nwkInfo = zap.controller.getNwkInfo();
	        console.log('Network information', nwkInfo);
	        console.log('ZigBeeService start done!');
	        // announce ZigBee network to CGS
	    	this.sendMessage(Message.SERVICE_INFO, {
	    		name 		: 'Zigbee network information',
	    		type		: 'network.zigbee',
	    		specData	: {
	    			channel 	: nwkInfo.channel,
	    			panId 		: nwkInfo.panId,
	    			ieeeAddr 	: nwkInfo.ieeeAddr,
	    			nwkAddr		: nwkInfo.nwkAddr
	    		}
	    	});      
	    }
	}.bind(this));
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
		
		//console.log(zap.list());
		
		var dev = zigbeeDevices['0x000d6f000bcb7472'];
		
		if(dev) {
			
			dev.Toggle();

		}
		
	}, 5000);

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
	if(cmd == Message.DEVICE_LIST) 		{ this.getDevices(); 		}
	if(cmd == Message.PAIRING_MODE) 	{ this.permitJoin(data); 	}
}

/*
 * Send message to remote service.
 */

ZigBeeService.prototype.sendMessage = function(cmd, data) {
	if(!this.socket) {
		console.error('Service not connected to the Service Gateway.');
		return;
	}
	/*if(!this.isReady) {
		cmd = Message.SERVICE_ERROR;
		data = { message : 'ZigBee service not ready. Try request later.' };
	}*/
	debug('sendMessage', 'command:', Message.inverted[cmd], ', data:', JSON.stringify(data, null, 4));
	var buf = JSON.stringify({ cmd : cmd, data : data }); //protoify([cmd, data]);
	this.emit('data', buf);
}

/*
 * Methods for RPC
 */

ZigBeeService.prototype.resetCoordinator = function(resetType) {
	var zap = this.zap,
		self = this;
	if(!zap) return;
	zap.reset(resetType, function (err) {
    	console.log('reset times: ' + (self.resetCount++));
   		if (!err) { // something wrong pull it up
   			zap.controller.request('SYS', 'ping', {}, function (err, rsp) {
   				if(err) { // something wrong pull it up
   					console.log(err);
   					process.exit(1);
   				}
   				else console.log(rsp);
     		});
     	} else {
     		console.log(err);
     		process.exit(1); // exit from service with error. Try process restart.
     	}
    });	
}

/*"clusters": {
"genBasic": {
    "dir": {
        "value": 1
    },
    "attrs": {
        "zclVersion": 1,
        "appVersion": 3,
        "stackVersion": 2,
        "hwVersion": 1,
        "modelId": "DOOR_TPV12",
        "dateCode": "20160311",
        "powerSource": 3,
        "locationDesc": "",
        "physicalEnv": 0,
        "deviceEnabled": 1,
        "alarmMask": 0
    }
},*/

ZigBeeService.prototype.findAttrsByClusterName = function(dev, clusterName) {
	var clusterAttrs,
		endpoints = dev.endpoints;
	if(endpoints) {
		_.each(endpoints, function(ep) {
			if(ep.clusters) {
				if(!clusterAttrs && ep.clusters[clusterName])
					clusterAttrs = ep.clusters[clusterName].attrs;
			}
		});
	}
	return clusterAttrs;
}

///////// TEMPORARY /////////

var zigbeeDevices = {};


function TemperatureSensor(dev) {
	this.dev = dev;
	this.tempEp = dev.getEndpoint(1);
	this.humiEp = dev.getEndpoint(2);
	
	setInterval(this.getTemperature.bind(this), 2000);
	setInterval(this.getHumidity.bind(this), 2000);

	//this.type = DeviceType.DT_TEMPERATURE_HUMIDITY_SENSOR;

}

/*
msTemperatureMeasurement {
	"measuredValue": 2496,
	"minMeasuredValue": -2000,
    "maxMeasuredValue": 12000,
    "tolerance": 100
}
*/

TemperatureSensor.prototype.getTemperature = function() {
	if(this.dev.status == 'online') {
		this.tempEp.foundation('msTemperatureMeasurement', 'read', [ { attrId: 'measuredValue' } ], function (err, rsp) {
			if(!err) {
				console.log('Temperature =', rsp);
				if(rsp.length === 1) {
					var data = rsp[0].attrData;
				}
			}
		});
	}
}

/*
msRelativeHumidity {
	"measuredValue": 5112,
	"minMeasuredValue": 0,
	"maxMeasuredValue": 10000,
    "tolerance": 300
}
*/

TemperatureSensor.prototype.getHumidity = function() {
	if(this.dev.status == 'online') {
		this.humiEp.foundation('msRelativeHumidity', 'read', [ { attrId: 'measuredValue' } ], function (err, rsp) {
			if(!err) {
				console.log('Humidity =', rsp);
				if(rsp.length === 1) {
					var data = rsp[0].attrData;
				}
			}
		});
	}
}


function SmartPlugActuator(dev) {
	this.dev = dev;
	this.ep = dev.getEndpoint(1);
	this.type = DeviceType.DT_SMART_PLUG;
	
	setInterval(this.getValue.bind(this), 2000);
}

// genOnOff -> onOff

SmartPlugActuator.prototype.getValue = function() {
	if(this.dev.status == 'online') {
		this.ep.foundation('genOnOff', 'read', [ { attrId: 0x0000 } ], function (err, rsp) {
			if(!err) {
				if(rsp.length === 1) {
					var data = rsp[0].attrData;
				}
			}
		});
	}
}

SmartPlugActuator.prototype.On = function(value) {
	if(this.dev.status == 'online') {	
		this.ep.functional('genOnOff', 'on', { }, function (err, rsp) { });
	}
}

SmartPlugActuator.prototype.Off = function(value) {
	if(this.dev.status == 'online') {	
		this.ep.functional('genOnOff', 'off', { }, function (err, rsp) { });
	}
}

SmartPlugActuator.prototype.Toggle = function(value) {
	//if(this.dev.status == 'online') {	
		this.ep.functional('genOnOff', 'toggle', { }, function (err, rsp) { });
	//}
}

function ContactSwitchSensor(dev) {
	this.dev = dev;
	this.ep = dev.getEndpoint(1);
	this.type = DeviceType.DT_CONTACT_SWITCH;

	//setInterval(this.getValue.bind(this), 2000);
	
	this.reportAttributes();
}

ContactSwitchSensor.prototype.reportAttributes = function() {
	
	/*"enrollRsp":{
        "params":[
            {"enrollrspcode":"uint8"},
            {"zoneid":"uint8"}
        ],
        "dir":0},*/
	
	/*this.ep.foundation('ssIasZone', 'write', [
	    { attrId: 'iasCieAddr', dataType: 'IEEE_ADDR', attrData: [ 0x00124b00, 0x07db79fe ] } ], function (err, rsp) {
		console.log('iasCieAddr write', rsp);
    });

	this.ep.foundation('ssIasZone', 'enrollRsp',
			[
			  { enrollrspcode: 0x00 },
			  { zoneid: 0xfe }
			  
			  //{ extra : 'configReport' }
			], function (err, rsp) {  // status = 140 UNREPORTABLE ATTRIBUTE
		console.log('Enroll reponse');
		if(!err) {
			console.log(JSON.stringify(rsp, null, 2));
		} else {
			console.error(err);
		}
	});*/
	
	/*"configReport": {
            "params":[
                {"direction":"uint8"},
                {"attrId":"uint16"},
                {"extra":"configReport"}
            ],
            "knownBufLen": 3
        },*/
	
	
	/*this.ep.foundation('ssIasZone', 'configReport',
			[
			  { attrId: 0x0002 },
			  { dataType: 0x31 }
			  
			  //{ extra : 'configReport' }
			], function (err, rsp) {  // status = 140 UNREPORTABLE ATTRIBUTE
		console.log('Report attributes response ');
		if(!err) {
			console.log(JSON.stringify(rsp, null, 2));
		} else {
			console.error(err);
		}
	});*/
	
}

ContactSwitchSensor.prototype.getValue = function() {
	if(this.dev.status == 'online') {
		this.ep.foundation('ssIasZone', 'read', [ { attrId: 0x0002 } ], function (err, rsp) {
			if(!err) {
				if(rsp.length === 1) {
					var data = rsp[0].attrData;
					
					// data = |7|6|5|4|3|2|1|0|, bit 0 - current state

					console.log('Contact switch value =', data);
					
					if(data == 33) console.log('Contact sensor is OPEN');
					if(data == 32) console.log('Contact sensor is CLOSE');
				}
			} else {
				console.error(err);
			}
		});
	}
}


function FireSensor(dev) {
	this.dev = dev;
	this.ep = dev.getEndpoint(1);
	this.type = DeviceType.DT_FIRE_SENSOR;

	setInterval(this.getValue.bind(this), 5000);
	
	//this.reportAttributes();
}

FireSensor.prototype.getValue = function() {
	if(this.dev.status == 'online') {
		this.ep.foundation('ssIasZone', 'read', [ { attrId: 0x0002 } ], function (err, rsp) {
			if(!err) {
				if(rsp.length === 1) {
					var data = rsp[0].attrData;
					
					console.log('Fire sensor value =', data);
				}
			} else {
				console.error(err);
			}
		});
	}
}

ZigBeeService.prototype.deviceType = function(dev) {	
	var epList = dev.epList,
		devType;

	// temperature sensor
	if (epList.length === 2 && _.includes(epList, 1) && _.includes(epList, 2)) {
		var ep = dev.getEndpoint(1);
		if (ep.getDevId() === 770) { // Temperature sensor
			devType = DeviceType.DT_TEMPERATURE_SENSOR;
	    }

	} else if (epList.length === 1 && _.includes(epList, 1)) {
		var ep = dev.getEndpoint(1);
        if (ep.getDevId() === 81) { // Smart socket
            devType = DeviceType.DT_SMART_PLUG;
        }
     
        if (ep.getDevId() === 1026) { // IAZ zone device
        	devType = DeviceType.DT_IAS_ZONE;
        	var attrs = this.findAttrsByClusterName(dev, 'ssIasZone');
        	if(attrs && attrs.zoneType) {
        		var zoneType = attrs.zoneType;
        		if(zoneType == 13)
        			devType = DeviceType.DT_MOTION_SENSOR;
        		if(zoneType == 21)
        			devType = DeviceType.DT_CONTACT_SWITCH;
        		if(zoneType == 40)
        			devType = DeviceType.DT_FIRE_SENSOR;
        		if(zoneType == 42)
        			devType = DeviceType.DT_WATER_SENSOR;
        	}
        }
    }
	
	// TODO: smart light there (KUDLED)

	return { key : DeviceType.inverted[devType], value : devType };
}

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

ZigBeeService.prototype.getDevices = function(callback) {
	var self = this;
	try {
		var devices = this.zap.list();
		devices.forEach(function(dev) {
			//console.log(dev.endpoints);
			//dev.deviceType = self.deviceType(self.zap.findDevByAddr(dev.ieeeAddr));
		});
		this.sendMessage(Message.DEVICE_LIST, { devices: devices });
	}
	catch(err) {
		console.error(err.stack);
	}
}

ZigBeeService.prototype.deviceState = function(msg) {
	
	console.log(JSON.stringify(msg, null, 2));
	
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
    
    if(state == DeviceState.DS_ONLINE) {
    	ieeeAddr = msg.data;
    	device = this.zap.findDevByAddr(ieeeAddr);
    	
    	console.log(JSON.stringify(device.dump(), null, 2));
    	
    	if(device) {
    		deviceType = this.deviceType(device);
    		
    		console.log(deviceType);
    		
    		switch(deviceType.value) {
    		
    			case DeviceType.DT_TEMPERATURE_SENSOR:
    				if(!zigbeeDevices[device.ieeeAddr]) {
        				//var specDev = new TemperatureSensor(device);
        				//zigbeeDevices[device.ieeeAddr] = specDev;
        			}			
    			break;
    		
    			case DeviceType.DT_CONTACT_SWITCH:
    				if(!zigbeeDevices[device.ieeeAddr]) {
        				//var specDev = new ContactSwitchSensor(device);
        				//zigbeeDevices[device.ieeeAddr] = specDev;
        			}
    			break;

    			case DeviceType.DT_FIRE_SENSOR:
    				if(!zigbeeDevices[device.ieeeAddr]) {
        				//var specDev = new FireSensor(device);
        				//zigbeeDevices[device.ieeeAddr] = specDev;
        			}			
    			break;
    		}
    		
    	}

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

module.exports = ZigBeeService;
