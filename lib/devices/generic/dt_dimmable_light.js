/*
 * Copyright (c) 2016, Bigsens, LLC
 * Dimmable LED light 
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	log4js = global.log4js,
	log = log4js.getLogger('DimmableLight'),
	debug = require('debug')('DimmableLight'),
	util = require('util'),
	DeviceType = require('../../service/protocol').DeviceType,
	PollingDevice = require('../generic/dt_polling_device');


function DimmableLight(dev) {
	DimmableLight.super_.apply(this, arguments);
	this.type = DeviceType.DT_DIMMABLE_LIGHT;
	this.endpoint = dev.getEndpoint(8);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		console.log('Dimmable light state is %s', value);
	}.bind(this));

	this.reportAttribute(this.endpoint, 'genOnOff', 0x0000, 5);
}

util.inherits(DimmableLight, PollingDevice);


DimmableLight.prototype.getState = function() {
	this.readAttribute(this.endpoint, 'genOnOff', 0x0000).then(function(dev, cluster, attr, value) {
		log.info('Dimmable light state is %s', value);
	}).fail(function(err) {
		log.error('Dimmable light error to get state', err);
	}).done();
}

DimmableLight.prototype.On = function() {
	this.invokeMethod(this.endpoint, 'genOnOff', 'on', {}).then(function(dev, cluster, cmd, rsp) {
		//
	}).done();
}

DimmableLight.prototype.Off = function() {
	this.invokeMethod(this.endpoint, 'genOnOff', 'off', {}).then(function(dev, cluster, cmd, rsp) {
		//
	}).done();
}

DimmableLight.prototype.Toggle = function() {
	this.invokeMethod(this.endpoint, 'genOnOff', 'toggle', {}).then(function(dev, cluster, cmd, rsp) {
		//
	}).done();
}

DimmableLight.prototype.Level = function(level) {
	
}


module.exports = DimmableLight;


