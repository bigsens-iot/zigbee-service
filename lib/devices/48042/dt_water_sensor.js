/*
 * Copyright (c) 2016, Bigsens, LLC
 * Water sensor
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('WaterSensor'),
	debug = require('debug')('WaterSensor'),
	util = require('util'),
	DeviceType = require('../../service/protocol').DeviceType,
	IASZoneDevice = require('../generic/dt_ias_zone');


function WaterSensor(dev) {
	WaterSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_WATER_SENSOR;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(attr == 0x0002) {
			var state = this.parseState(value);
			if(state.Alarm1 || state.Alarm2) {
				console.log('!!! Water detected !!!');
			} else {
				console.log('Water not detected');
			}
		}
	}.bind(this));

	this.reportAttribute(this.ep, 'ssIasZone', 0x0002, 5);

}

util.inherits(WaterSensor, IASZoneDevice);

module.exports = WaterSensor;

