/*
 * Copyright (c) 2016, Bigsens, LLC
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	Q = require('q'),
	log4js = global.log4js,
	log = log4js.getLogger('Drivers'),
	debug = require('debug')('Drivers'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	Concentrate = require('concentrate'),
	DeviceType = require('../service/protocol').DeviceType,
	aguid = require('aguid');



function AbstractDevice(dev)  {
	this.dev = dev;
	this.guid;
	if(dev.ieeeAddr) {
		this.guid = aguid(dev.ieeeAddr);
	} else {
		log.warn('Device ieee address not found.');
	}
}

util.inherits(AbstractDevice, EventEmitter);

AbstractDevice.prototype.getDev = function() {
	return this.dev;
}

AbstractDevice.prototype.getGuid = function() {
	return this.guid;
}

AbstractDevice.prototype.readAttribute = function(endpoint, cluster, attr, callback) {
	var deferred = Q.defer();
	if(this.dev && this.dev.status == 'online') {
		endpoint.foundation(cluster, 'read', [ { attrId: attr } ])
			.then(function(rsp) {
				if(rsp && rsp.length === 1) {
					this.emit('readAttribute', this.dev, cluster, attr, rsp[0].attrData);
					deferred.resolve(this.dev, cluster, attr, rsp[0].attrData);
				}
			}.bind(this))
			.fail(function(err) {
				log.error('Read attribute', err);
				deferred.reject(err);
			}).done();
	} else {
		deferred.reject();
	}
	return deferred.promise.nodeify(callback);
}

AbstractDevice.prototype.cleanup = function() {
	if(this.clearPolls) {
		this.clearPolls();
	}
}

function PollingDevice(dev) {
	PollingDevice.super_.apply(this, arguments);
	this.timerId = [];
	this.on('readAttribute', function(device, cluster, attr, value) {
		this.emit('reportAttribute', device, cluster, attr, value);
	}.bind(this));
}

util.inherits(PollingDevice, AbstractDevice);

PollingDevice.prototype.reportAttribute = function(endpoint, cluster, attr, interval) {
	var tid = setInterval(this.readAttribute.bind(this, endpoint, cluster, attr), interval || 10000);
	this.timerId.push(tid);
}

PollingDevice.prototype.clearPolls = function() {
	_.forEach(this.timerId, function(id) {
		clearInterval(id);
	});
}

function TemperatureSensor(dev) {
	TemperatureSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_TEMPERATURE_SENSOR;
	this.tempEp = this.dev.getEndpoint(1);
	this.humiEp = this.dev.getEndpoint(2);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(cluster == 'msTemperatureMeasurement') {
			debug('Temperature is %s', value);
		}
		if(cluster == 'msRelativeHumidity') {
			debug('Humidity is %s', value);
		}
	});

	this.reportAttribute(this.tempEp, 'msTemperatureMeasurement', 'measuredValue', 15000);
	this.reportAttribute(this.humiEp, 'msRelativeHumidity', 'measuredValue', 30000);

	//this.reportAttributes();
}

util.inherits(TemperatureSensor, PollingDevice);

TemperatureSensor.prototype.reportAttributes = function() {
	
	this.tempEp.foundation('msTemperatureMeasurement', 'configReport',
			[
			  { attrId: 'measuredValue' },
			  { dataType: 0x29 } // Signed 16-bit Integer
			  
			  //{ extra : 'configReport' }
			], function (err, rsp) {  // status = 140 UNREPORTABLE ATTRIBUTE
		console.log('Report attributes response ');
		if(!err) {
			console.log(JSON.stringify(rsp, null, 2));
		} else {
			console.error(err);
		}
	});

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
		this.tempEp.foundation('msTemperatureMeasurement', 'read', [ { attrId: 'measuredValue' } ])
			.then(function(rsp) {
				if(rsp) {
					console.log('Temperature =', rsp);
					if(rsp.length === 1) {
						var data = rsp[0].attrData;
					}
				}
			})
			.fail(function(err) {
				console.log(err);
			}).done();
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
		this.humiEp.foundation('msRelativeHumidity', 'read', [ { attrId: 'measuredValue' } ])
			.then(function(rsp) {
				if(rsp) {
					console.log('Humidity =', rsp);
					if(rsp.length === 1) {
						var data = rsp[0].attrData;
					}
				}
			})
			.fail(function(err) {
				console.log(err)
			}).done();
	}
}


function SmartPlugActuator(dev) {
	SmartPlugActuator.super_.apply(this, arguments);
	this.type = DeviceType.DT_SMART_PLUG;
	this.ep = dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		console.log('Socket state is %s', value);
	}.bind(this));

	this.reportAttribute(this.ep, 'genOnOff', 0x0000, 5000);
}

util.inherits(SmartPlugActuator, AbstractDevice);

// genOnOff -> onOff

SmartPlugActuator.prototype.getState = function() {
	this.readAttribute(this.ep, 'genOnOff', 0x0000).this(function(value) {
		console.log('Smart plug state is %s', value);
	})
	.fail(function(err) {
		log.error('Smart plug error to get state');
	})
	.done();
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

/*
 * IAS Zone
 */

var ZONE_STATE_BITS = [
    'Alarm1', 'Alarm2', 'Tamper', 'Battery', 
    'SupervisionReports', 'RestoreReports', 'Trouble', 'AC',
    'Reserved1', 'Reserved2', 'Reserved3', 'Reserved4',
    'Reserved5', 'Reserved6', 'Reserved7', 'Reserved8'
];

function IASZoneDevice(dev) {
	IASZoneDevice.super_.apply(this, arguments);
	this.zoneStatus = null;
	this.zoneState = null;
	//this.ep = this.dev.getEndpoint(1);
}

util.inherits(IASZoneDevice, PollingDevice);

IASZoneDevice.prototype.parseState = function(zoneState) {
	var state = {};
	Concentrate().uint16le(zoneState).result().readUInt16LE(0).toString(2)
		.split('').reverse().forEach(function(bit, pos) {
			state[ZONE_STATE_BITS[pos]] = (bit === '1');
		});
	this.zoneState = state;
	return state;
}


function ContactSwitchSensor(dev) {
	ContactSwitchSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_CONTACT_SWITCH;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(attr == 0x0002) {
			var state = this.parseState(value);
			if(state.Alarm1) {
				console.log('Contact sensor is OPEN');
			} else {
				console.log('Contact sensor is CLOSE')
			}
		}
	}.bind(this));

	this.reportAttribute(this.ep, 'ssIasZone', 0x0002, 2000);

}

util.inherits(ContactSwitchSensor, IASZoneDevice);

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


function FireSensor(dev) {
	FireSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_FIRE_SENSOR;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(attr == 0x0002) {
			var state = this.parseState(value);
			if(state.Alarm1 || state.Alarm2) {
				debug('!!! Smoke detected !!!');
			}
		}
	}.bind(this));

	this.reportAttribute(this.ep, 'ssIasZone', 0x0002, 10000);

}

util.inherits(FireSensor, IASZoneDevice);

function WaterSensor(dev) {
	WaterSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_WATER_SENSOR;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(attr == 0x0002) {
			var state = this.parseState(value);
			if(state.Alarm1 || state.Alarm2) {
				debug('!!! Water detected !!!');
			}
		}
	}.bind(this));

	this.reportAttribute(this.ep, 'ssIasZone', 0x0002, 10000);

}

util.inherits(WaterSensor, IASZoneDevice);

module.exports = {
	TemperatureSensor : TemperatureSensor,
	ContactSwitchSensor : ContactSwitchSensor,
	FireSensor : FireSensor,
	WaterSensor : WaterSensor,
	SmartPlugActuator : SmartPlugActuator
};

