/*
 * Copyright (c) 2016, Bigsens, LLC
 * Smart plug actuator
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	log4js = global.log4js,
	log = log4js.getLogger('SmartPlugActuator'),
	debug = require('debug')('SmartPlugActuator'),
	util = require('util'),
	DeviceType = require('../../protocol').DeviceType,
	PollingDevice = require('../generic/dt_polling_device');


function SmartPlugActuator(dev) {
	SmartPlugActuator.super_.apply(this, arguments);
	this.type = DeviceType.DT_SMART_PLUG;
	this.ep = dev.getEndpoint(1);

	this.attr('State', 'genOnOff.onOff');
	this.attr('Voltage', 'haElectricalMeasurement.rmsVoltage', function(v) { return v/100; });
	this.attr('Current', 'haElectricalMeasurement.rmsCurrent', function(v) { return v/100; });
	this.attr('ActivePower', 'haElectricalMeasurement.activePower');

	this.reportAttribute(this.ep, 'genOnOff', 'onOff', 5);
	this.reportAttribute(this.ep, 'haElectricalMeasurement', 'rmsVoltage', 30);
	this.reportAttribute(this.ep, 'haElectricalMeasurement', 'rmsCurrent', 60);
	this.reportAttribute(this.ep, 'haElectricalMeasurement', 'activePower', 60);
}

util.inherits(SmartPlugActuator, PollingDevice);

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

SmartPlugActuator.prototype.On = function() {
	if(this.dev.status == 'online') {	
		this.ep.functional('genOnOff', 'on', { }, function (err, rsp) { });
	}
}

SmartPlugActuator.prototype.Off = function() {
	if(this.dev.status == 'online') {	
		this.ep.functional('genOnOff', 'off', { }, function (err, rsp) { });
	}
}

SmartPlugActuator.prototype.Toggle = function() {
	//if(this.dev.status == 'online') {	
		this.ep.functional('genOnOff', 'toggle', { }, function (err, rsp) { });
	//}
}

module.exports = SmartPlugActuator;

