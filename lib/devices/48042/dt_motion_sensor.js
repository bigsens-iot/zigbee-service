/*
 * Copyright (c) 2016, Bigsens, LLC
 * Motion sensor
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('MotionSensor'),
	debug = require('debug')('MotionSensor'),
	util = require('util'),
	DeviceType = require('../../protocol').DeviceType,
	IASZoneDevice = require('../generic/dt_ias_zone');


function MotionSensor(dev) {
	MotionSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_MOTION_SENSOR;
	this.endpoint = this.dev.getEndpoint(1);

	this.enroll(this.endpoint, 0x0).then(function(rsp) {
		console.log('Enroll response', rsp);
	}).done();

}

util.inherits(MotionSensor, IASZoneDevice);

module.exports = MotionSensor;

