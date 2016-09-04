/*
 * Copyright (c) 2016, Bigsens, LLC
 * Temperature sensor
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	Q = require('q'),
	log4js = global.log4js,
	log = log4js.getLogger('TemperatureSensor'),
	debug = require('debug')('TemperatureSensor'),
	util = require('util'),
	DeviceType = require('../../service/protocol').DeviceType,
	PollingDevice = require('../generic/dt_polling_device');


function TemperatureSensor(dev) {
	TemperatureSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_TEMPERATURE_SENSOR;
	this.tempEp = this.dev.getEndpoint(1);
	this.humiEp = this.dev.getEndpoint(2);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(cluster == 'msTemperatureMeasurement') {
			debug('Temperature is %s', value);
		}
		if(cluster == 'msRelativeHumidity') {
			debug('Humidity is %s', value);
		}
	});

	this.reportAttribute(this.tempEp, 'msTemperatureMeasurement', 'measuredValue', 15000);
	this.reportAttribute(this.humiEp, 'msRelativeHumidity', 'measuredValue', 30000);

	//this.reportAttributes();
}

util.inherits(TemperatureSensor, PollingDevice);

TemperatureSensor.prototype.configReport = function() {

	this.tempEp.foundation('msTemperatureMeasurement', 'configReport',
			[
			  { attrId: 'measuredValue' },
			  { dataType: 0x29 } // Signed 16-bit Integer
			  
			  //{ extra : 'configReport' }
			], function (err, rsp) {  // status = 140 UNREPORTABLE ATTRIBUTE
		console.log('Report attributes response ');
		if(!err) {
			console.log(JSON.stringify(rsp, null, 2));
		} else {
			console.error(err);
		}
	});

}

/*
msTemperatureMeasurement {
	"measuredValue": 2496,
	"minMeasuredValue": -2000,
    "maxMeasuredValue": 12000,
    "tolerance": 100
}
*/

TemperatureSensor.prototype.getTemperature = function(callback) {
	var deferred = Q.defer();
	this.readAttribute(this.tempEp, 'msTemperatureMeasurement', 'measuredValue')
		.then(function(dev, cluster, attr, value) {
			deffered.resolve(value);
		})
		.fail(function(err) {
			log.error('Read temperature value', err);
			deffered.reject(err);
		})
		.done();
	return deferred.promise.nodeify(callback);
}

/*
msRelativeHumidity {
	"measuredValue": 5112,
	"minMeasuredValue": 0,
	"maxMeasuredValue": 10000,
    "tolerance": 300
}
*/

TemperatureSensor.prototype.getHumidity = function(callback) {
	var deferred = Q.defer();
	this.readAttribute(this.tempEp, 'msRelativeHumidity', 'measuredValue')
		.then(function(dev, cluster, attr, value) {
			deffered.resolve(value);
		})
		.fail(function(err) {
			log.error('Read humidity value', err);
			deffered.reject(err);
		})
		.done();
	return deferred.promise.nodeify(callback);
}

module.exports = TemperatureSensor;

