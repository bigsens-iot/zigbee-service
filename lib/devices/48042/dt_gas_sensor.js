/*
 * Copyright (c) 2016, Bigsens, LLC
 * Gas sensor
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('GasSensor'),
	debug = require('debug')('GasSensor'),
	util = require('util'),
	DeviceType = require('../../service/protocol').DeviceType,
	IASZoneDevice = require('../generic/dt_ias_zone');


function GasSensor(dev) {
	GasSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_GAS_SENSOR;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(attr == 0x0002) {
			var state = this.parseState(value);
			if(state.Alarm1 || state.Alarm2) {
				console.log('!!! Gas detected !!!');
			} else {
				console.log('Gas not detected');
			}
		}
	}.bind(this));

	this.reportAttribute(this.ep, 'ssIasZone', 0x0002, 10000);

}

util.inherits(GasSensor, IASZoneDevice);

module.exports = GasSensor;

