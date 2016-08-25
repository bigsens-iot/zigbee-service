/*
 * Copyright (c) 2016, Bigsens, LLC
 * ZigBee ZNP Service (ZZS)
 * Target chips cc2530, cc3531
 * Need to add firmware upload routines depended from platform target.
 * Platform target <vendorId:productId>
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	log4js = require('log4js'),
	ZigBeeService = require('./lib/service/ZigBeeService'),
	Table = require('cli-table');

log4js.configure({
	appenders : [{
		type : "console"
    }, {
    	"type" : "dateFile",
        "filename" : (process.platform == 'linux' ? '/var/log/bigsens/' : '') + 'bs-zigbee.log',
        "pattern" : "-yyyy-MM-dd",
        "alwaysIncludePattern" : false
    }],
    replaceConsole : false
});

// make it global
global.log4js = log4js;

function main() {

	/*
	 * TODO: Move service configuration to the instance meta.
	 * Configuration can depends from SBC where service running.
	 * For example current solution have CC2530 on the board where
	 * communication goes via hard linked uart on /dev/ttyS3.
	 * On the SBC's with the usb dongle uart can variate from
	 * /dev/ttyS* to /dev/ttyACM*. Partial problem with uart can be
	 * solved by iteration for ZNP search via all uarts.
	 */

	var cfg = {
		platformTarget : 'bigsens:smartbox',
		chipTarget : 'cc2530',
		uart : '/dev/ttyS3',
		panid : 0xff77
	}

	var service = new ZigBeeService(cfg);

	service.start();

	/*
	service.on('ready', function(srv) {
		console.log('Service started');
		setInterval(function() {
			srv.discoverDevices(function(list) {
				displayDevices(list);
			});
		}, 10000);
	});
	*/

}

function displayDevices(list) {
	var table = new Table({
		head: ['Name', 'ShortAddr', 'IEEE Address', 'Capabilities'],
		colWidths: [12, 12, 25, 64],
	});
	_.each(list, function(device) {
		table.push([
		     device.name,
		     device.shortAddress ? device.shortAddress.toString(16) : 'undefined',
			 device.IEEEAddress ? device.IEEEAddress.toString(16) : 'undefined',
			 JSON.stringify(device.capabilities)
		]);
	});
	console.log(table.toString());
}

main();
