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
	this.nwkInfo = zap.controller.getNwkInfo();
	this.coordAddr = this.nwkInfo.ieeeAddr;

	this.drivers = {};
	// Store device objects by device types
	this.devices = {}; // key: ieeeAddr, value: device object

	var innerDevices = zap._devbox.exportAllObjs();
	innerDevices.forEach(function(innerDev) {
		this.registerDevice(innerDev);
	}.bind(this));
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

// DEVICE_LIST
DeviceManager.prototype.deviceList = function() {
	var devList = [];
	_.each(this.devices, function(device) {
		devList.push(device.info());
	});
	return devList;
}

// DEVICE_GET_INFO_BY_ID
DeviceManager.prototype.deviceInfoById = function(id) {
	var dev = this.devices[id];
	return dev ? dev.info() : 'undefined';
}

// DEVICE_GET_EXTENDED_INFO_BY_ID
DeviceManager.prototype.deviceExtendedInfoById = function(id) {
	var dev = this.devices[id];
	return dev ? dev.extendedInfo() : 'undefined';
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

DeviceManager.prototype._deviceType = function(innerDev) {	
	var epList = innerDev.epList,
		devType;

	// smart plug, water leak, entry sensor, etc.
	if(epList.length === 1 && _.includes(epList, 1)) {
		var ep = innerDev.getEndpoint(1);
		if(ep) {
			if(ep.getDevId() === 81) { // Smart socket
	            devType = DeviceType.DT_SMART_PLUG;
	        } else if(ep.getDevId() === 1026) { // IAZ zone device
	        	devType = DeviceType.DT_IAS_ZONE;
	        	var attrs = this.findAttrsByClusterName(innerDev, 'ssIasZone');
	        	if(attrs && attrs.zoneType) {
	        		devType = this._zoneType(attrs.zoneType) || devType;
	        	}
	        }
		}
    } else {
    	if(epList.length === 2 && _.includes(epList, 1) && _.includes(epList, 2)) {
    		var ep = innerDev.getEndpoint(1);
    		if(ep) {
    			if(ep.getDevId() === 770) { // Temperature sensor
        			devType = DeviceType.DT_TEMPERATURE_SENSOR;
        		}
    		}
    	}
    }

	if(epList.length > 0) {
		var ep = innerDev.getEndpoint(1); // need to evaluate
		if(ep) {
			if(ep.getDevId() === 263) { // Occupancy sensor
	            devType = DeviceType.DT_OCCUPANCY_SENSOR;
			}
		}
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

DeviceManager.prototype.registerDevice = function(innerDev) {
	var driver, device;
	if(innerDev.getIeeeAddr() == this.coordAddr) return;
	var deviceType = this._deviceType(innerDev);
	if(!deviceType.value) {
		// TODO: Try to discover type 
	} else if(deviceType.value == DeviceType.DT_IAS_ZONE) {
		// TODO: Try to get zoneType, or allow to build IASZoneDevice
		// but extend object to the specific type later
	} else {
		if(!this.devices[innerDev.ieeeAddr]) {
			driver = this.getDriverByType(innerDev.manufId, deviceType); //mapDrivers[deviceType.key];
			if(driver) {
				device = new driver(innerDev);
				this.devices[device.ieeeAddr] = device;
				device.on('reportAttribute', this._reportAtrribute.bind(this)); // device, cluster, attr, value
				log.info('Device type %s is registered %s', deviceType.key, fmtJson(innerDev.dump()));
			} else {
				var errmsg = new String('Driver for deivce type %s not found.', deviceType);
				log.error(errmsg);
				//return new Error(errmsg);
			}
		} else {
			// Device already registered
		}
	}
	return device ? device.info() : null;
}

DeviceManager.prototype.unregisterDevice = function(ieeeAddr) {
	var info = null,
		device = this.devices[ieeeAddr];
	if(device) {
		info = device.info();
		device.cleanup();
		delete this.devices[ieeeAddr];
		console.log('Device %s is unregistered', ieeeAddr);
	}
	return info;
}

DeviceManager.prototype.updateDevice = function(ieeeAddr) {
	var device = null,
		innerDev = this.zap.findDevByAddr(ieeeAddr);
	if(innerDev) {
		var device = this.devices[ieeeAddr];
		if(device) {
			this.devices[ieeeAddr].dev = innerDev;
		} else if(!device && innerDev.status == 'online') {
			this.registerDevice(innerDev);
		}
	}
	return device ? device.info() : null;
}

DeviceManager.prototype.checkOnline = function() {
	var self = this,
		controller = this.zap.controller,
		innerDevices = this.zap._devbox.exportAllObjs(),
		updateStatus = function(innerDev, status) {
			console.log('device %s status is %s', innerDev.getIeeeAddr(), status);
			innerDev.setNetInfo({ status: status });
			this.zap.emit('ind', {
				type: status == 'online' ? 'devOnline' : 'devOffline',
				data: innerDev.getIeeeAddr()
			});
		}

	innerDevices.forEach(function(innerDev) {
        var nwkAddr = innerDev.getNwkAddr();
        controller.request('ZDO', 'nodeDescReq', { dstaddr: nwkAddr, nwkaddrofinterest: nwkAddr })
        .timeout(5000).fail(function() {
        	return controller.request('ZDO', 'nodeDescReq', { dstaddr: nwkAddr,
        		nwkaddrofinterest: nwkAddr }).timeout(5000);
        }).then(function() {
        	if(innerDev.status == 'unknown' || innerDev.status == 'offline') {
        		updateStatus.call(self, innerDev, 'online');
        	}
        }).fail(function() {
        	if(innerDev.status == 'online') {
        		updateStatus.call(self, innerDev, 'offline');
        	}
        }).done();
	});
}

DeviceManager.prototype.cleanup = function() {
	this.devices.forEach(function(dev) {
		this.unregisterDevice(dev);
	});
}

DeviceManager.prototype._reportAtrribute = function(device, cluster, attr, value) {
	this.emit('reportAttribute', device, cluster, attr, value);
}

//other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}


module.exports = DeviceManager;

