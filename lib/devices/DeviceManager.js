/*
 * Copyright (c) 2016, Bigsens, LLC
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	log4js = global.log4js,
	log = log4js.getLogger('DeviceManager'),
	debug = require('debug')('DeviceManager'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	P = require('../service/protocol'),
	aguid = require('aguid');

var Message = P.Message,
	DeviceState = P.DeviceState,
	DeviceType = P.DeviceType;

// Need go to the dynamic extension of the new device types
/*var mapDrivers = {
	'DT_TEMPERATURE_SENSOR' : D.TemperatureSensor,
	'DT_CONTACT_SWITCH' : D.ContactSwitchSensor,
	'DT_FIRE_SENSOR' : D.FireSensor,
	'DT_WATER_SENSOR' : D.WaterSensor,
	'DT_OCCUPANCY_SENSOR' : D.OccupancySensor,
	'DT_SMART_PLUG' : D.SmartPlugActuator
}*/

function DeviceManager(zap) {
	this.zap = zap;
	this.drivers = {};
	// Store device objects by device types
	this.devices = {}; // key: ieeeAddr, value: device object
}

util.inherits(DeviceManager, EventEmitter);

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

DeviceManager.prototype.findAttrsByClusterName = function(dev, clusterName) {
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

DeviceManager.prototype._zoneType = function(zoneType) {
	var devType;
	if(zoneType == 13) {
		devType = DeviceType.DT_MOTION_SENSOR;
	} if(zoneType == 21) {
		devType = DeviceType.DT_CONTACT_SWITCH;
	} else if(zoneType == 40) {
		devType = DeviceType.DT_FIRE_SENSOR;
	} if(zoneType == 42) {
		devType = DeviceType.DT_WATER_SENSOR;
	}
	return devType;
}

DeviceManager.prototype._deviceType = function(dev) {	
	var epList = dev.epList,
		devType;

	// smart plug, water leak, entry sensor, etc.
	if (epList.length === 1 && _.includes(epList, 1)) {
		var ep = dev.getEndpoint(1);
        if (ep.getDevId() === 81) { // Smart socket
            devType = DeviceType.DT_SMART_PLUG;
        }
        if (ep.getDevId() === 1026) { // IAZ zone device
        	devType = DeviceType.DT_IAS_ZONE;
        	var attrs = this.findAttrsByClusterName(dev, 'ssIasZone');
        	if(attrs && attrs.zoneType) {
        		devType = this._zoneType(attrs.zoneType) || devType;
        	}
        }
    } else {
    	if (epList.length === 2 && _.includes(epList, 1) && _.includes(epList, 2)) {
    		var ep = dev.getEndpoint(1);
    		if (ep.getDevId() === 770) // Temperature sensor
    			devType = DeviceType.DT_TEMPERATURE_SENSOR;
    	}
    }

	if (epList.length > 0) {
		var ep = dev.getEndpoint(1); // need to evaluate
		if (ep.getDevId() === 263) // Occupancy sensor
            devType = DeviceType.DT_OCCUPANCY_SENSOR;
	}

	return { key : DeviceType.inverted[devType], value : devType };
}

// TODO
DeviceManager.prototype.uploadDriver = function() {}

// Driver name is the device type in low case
DeviceManager.prototype.loadDriver = function(manufId, driverName) {
	if(!this.drivers[driverName]) {
		this.drivers[driverName] = require('./'+manufId+'/'+driverName);
	}
	return this.drivers[driverName];
}

DeviceManager.prototype.getDriverByType = function(manufId, deviceType) {
	var driverName = deviceType.key.toLowerCase();
	return this.loadDriver(manufId, driverName);
}

DeviceManager.prototype.registerDevice = function(device) {
	var deviceType = this._deviceType(device);

	if(deviceType.value == DeviceType.DT_IAS_ZONE) {
		// TODO: Try to get zoneType, or allow to build IASZoneDevice
		// but extend object to the specific type later
	} else {
		if(!this.devices[device.ieeeAddr]) {
			var driver = this.getDriverByType(device.manufId, deviceType); //mapDrivers[deviceType.key];
			if(driver) {
				this.devices[device.ieeeAddr] = new driver(device);
				log.info('Device type %s is registered %s', deviceType.key, fmtJson(device.dump()));
			} else {
				log.warn('Driver for deivce type %s not found.', deviceType);
			}
		} else {
			// Device already registered
		}
	}
}

DeviceManager.prototype.unregisterDevice = function(addr) {
	if(this.devices[addr]) {
		this.devices[addr].cleanup();
		delete this.devices[addr];
		console.log('Device %s is unregistered', addr);
	}
}

DeviceManager.prototype.updateDevice = function(dev) {
	if(dev) {
		var ieeeAddr = dev.getIeeeAddr();
		if(this.devices[ieeeAddr]) {
			this.devices[ieeeAddr].dev = dev;
		} else if(!this.devices[ieeeAddr] && dev.status == 'online') {
			this.registerDevice(dev);
		}
	}
}

DeviceManager.prototype.checkOnline = function() {
	var self = this,
		controller = this.zap.controller,
		devices = this.zap._devbox.exportAllObjs(),
		updateStatus = function(dev, status) {
			console.log('device %s status is %s', dev.getIeeeAddr(), status);
			dev.setNetInfo({ status: status });
			this.updateDevice(dev);
			this.zap.emit('ind', {
				type: status == 'online' ? 'devOnline' : 'devOffline',
				data: dev.getIeeeAddr()
			});
		}

	devices.forEach(function(dev) {
        var nwkAddr = dev.getNwkAddr();

        controller.request('ZDO', 'nodeDescReq', { dstaddr: nwkAddr, nwkaddrofinterest: nwkAddr })
        .timeout(5000).fail(function() {
        	return controller.request('ZDO', 'nodeDescReq', { dstaddr: nwkAddr,
        		nwkaddrofinterest: nwkAddr }).timeout(5000);
        }).then(function() {
        	if(dev.status == 'unknown' || dev.status == 'offline') {
        		updateStatus.call(self, dev, 'online');
        	}
        }).fail(function() {
        	if(dev.status == 'online') {
        		updateStatus.call(self, dev, 'offline');
        	}
        }).done();
	});
}


//other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}


module.exports = DeviceManager;

