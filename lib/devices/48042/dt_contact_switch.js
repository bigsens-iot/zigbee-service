/*
 * Copyright (c) 2016, Bigsens, LLC
 * Contact switch (entry) sensor
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('ContactSwitchSensor'),
	debug = require('debug')('ContactSwitchSensor'),
	util = require('util'),
	DeviceType = require('../../service/protocol').DeviceType,
	IASZoneDevice = require('../generic/dt_ias_zone');


function ContactSwitchSensor(dev) {
	ContactSwitchSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_CONTACT_SWITCH;
	this.endpoint = this.dev.getEndpoint(1);

	this.enroll(this.endpoint, 0x0).then(function() {
		console.log('Enrolled successful');
	}).done();

}

util.inherits(ContactSwitchSensor, IASZoneDevice);

module.exports = ContactSwitchSensor;

