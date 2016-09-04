/*
 * Copyright (c) 2016, Bigsens, LLC
 * Occupancy sensor
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('OccupancySensor'),
	debug = require('debug')('OccupancySensor'),
	util = require('util'),
	DeviceType = require('../../service/protocol').DeviceType,
	PollingDevice = require('./dt_polling_device');


var OCCUPANCY_SENSOR_TYPE = {
	'PIR' : 0x00,
	'Ultrasonic' : 0x01,
	'PIR and ultrasonic' : 0x02
	// Reserved : 0x03 – 0xff
}

function OccupancySensor(dev) {
	OccupancySensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_OCCUPANCY_SENSOR;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(attr == 'occupancy') {
			// 1 = occupied, 0 = unoccupied
			debug('Occupancy sensor value = %s', value);
		}
	}.bind(this));

	this.reportAttribute(this.ep, 'msOccupancySensing', 'occupancy', 2000);

	/*this.readAttribute(this.ep, 'msOccupancySensing', 'occupancySensorType').then(function(value) {
		console.log('Occupancy sensor type', value);
	});*/ 

}

util.inherits(OccupancySensor, PollingDevice);

module.exports = OccupancySensor;

