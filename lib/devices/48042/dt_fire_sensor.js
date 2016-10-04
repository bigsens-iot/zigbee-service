/*
 * Copyright (c) 2016, Bigsens, LLC
 * Fire (smoke) sensor
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('FireSensor'),
	debug = require('debug')('FireSensor'),
	util = require('util'),
	DeviceType = require('../../protocol').DeviceType,
	IASZoneDevice = require('../generic/dt_ias_zone');


function FireSensor(dev) {
	FireSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_FIRE_SENSOR;
	this.endpoint = this.dev.getEndpoint(1);

	this.init();

}

util.inherits(FireSensor, IASZoneDevice);

FireSensor.prototype.init = function() {
	this.enroll(this.endpoint, 0x0).then(function() {
		console.log('Enrolled successful');
	}).done();
}

module.exports = FireSensor;

