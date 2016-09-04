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
	this.devices = {};
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
        		var zoneType = attrs.zoneType;
        		if(zoneType == 13)
        			devType = DeviceType.DT_MOTION_SENSOR;
        		if(zoneType == 21) {
        			devType = DeviceType.DT_CONTACT_SWITCH;
        		}
        		if(zoneType == 40)
        			devType = DeviceType.DT_FIRE_SENSOR;
        		if(zoneType == 42)
        			devType = DeviceType.DT_WATER_SENSOR;
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
DeviceManager.prototype.loadDriver = function(driverName) {
	if(!this.drivers[driverName]) {
		this.drivers[driverName] = require('./'+driverName);
	}
	return this.drivers[driverName];
}

DeviceManager.prototype.getDriverByType = function(deviceType) {
	var name = deviceType.key.toLowerCase();
	return this.loadDriver(name);
}

DeviceManager.prototype.registerDevice = function(device) {
	var deviceType = this._deviceType(device);
	if(!this.devices[device.ieeeAddr]) {
		var driver = this.getDriverByType(deviceType); //mapDrivers[deviceType.key];
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

DeviceManager.prototype.unregisterDevice = function(addr) {
	if(this.devices[addr]) {
		this.devices[addr].cleanup();
		delete this.devices[addr];
		console.log('Device %s is unregistered', addr);
	}
}


//other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}


module.exports = DeviceManager;

