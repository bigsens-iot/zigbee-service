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
	IASZoneDevice = require('./dt_ias_zone');


function ContactSwitchSensor(dev) {
	ContactSwitchSensor.super_.apply(this, arguments);
	this.type = DeviceType.DT_CONTACT_SWITCH;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		if(attr == 0x0002) {
			var state = this.parseState(value);
			if(state.Alarm1) {
				console.log('Contact sensor is OPEN');
			} else {
				console.log('Contact sensor is CLOSE')
			}
		}
	}.bind(this));

	this.reportAttribute(this.ep, 'ssIasZone', 0x0002, 2000);

}

util.inherits(ContactSwitchSensor, IASZoneDevice);

ContactSwitchSensor.prototype.reportAttributes = function() {

	/*"enrollRsp":{
        "params":[
            {"enrollrspcode":"uint8"},
            {"zoneid":"uint8"}
        ],
        "dir":0},*/
	
	/*this.ep.foundation('ssIasZone', 'write', [
	    { attrId: 'iasCieAddr', dataType: 'IEEE_ADDR', attrData: [ 0x00124b00, 0x07db79fe ] } ], function (err, rsp) {
		console.log('iasCieAddr write', rsp);
    });

	this.ep.foundation('ssIasZone', 'enrollRsp',
			[
			  { enrollrspcode: 0x00 },
			  { zoneid: 0xfe }
			  
			  //{ extra : 'configReport' }
			], function (err, rsp) {  // status = 140 UNREPORTABLE ATTRIBUTE
		console.log('Enroll reponse');
		if(!err) {
			console.log(JSON.stringify(rsp, null, 2));
		} else {
			console.error(err);
		}
	});*/
	
	/*"configReport": {
            "params":[
                {"direction":"uint8"},
                {"attrId":"uint16"},
                {"extra":"configReport"}
            ],
            "knownBufLen": 3
        },*/
	
	
	/*this.ep.foundation('ssIasZone', 'configReport',
			[
			  { attrId: 0x0002 },
			  { dataType: 0x31 }
			  
			  //{ extra : 'configReport' }
			], function (err, rsp) {  // status = 140 UNREPORTABLE ATTRIBUTE
		console.log('Report attributes response ');
		if(!err) {
			console.log(JSON.stringify(rsp, null, 2));
		} else {
			console.error(err);
		}
	});*/
	
}

module.exports = ContactSwitchSensor;

