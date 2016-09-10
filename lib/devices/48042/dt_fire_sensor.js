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
	DeviceType = require('../../service/protocol').DeviceType,
	IASZoneDevice = require('../generic/dt_ias_zone');


function FireSensor(dev) {
	FireSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_FIRE_SENSOR;
	this.endpoint = this.dev.getEndpoint(1);

	this.enroll(this.endpoint, 0x0).then(function(rsp) {
		console.log('Enroll response', rsp);
	}).done();

}

util.inherits(FireSensor, IASZoneDevice);

module.exports = FireSensor;

