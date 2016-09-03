/*
 * Marvel SoC out of memory fix
 * 
 * Failed on Marvel chips when to requested more than 8 attributes in one batch.
 * Fix for error code 137 : An operation (e.g. an attempt to create an entry in a table)
 * failed due to an insufficient amount of free space available.
 * 
 * DIRTY HACK 
 * readRecs = readRecs.slice(0, 8);
 * 
 * Author: Constantin Alexandrov
 * 
 */

// Split attributes requests to 8 attributes per chunk
af.zclClusterAttrsReq = function (dstEp, cId, callback) {

    var deferred = Q.defer();    
    var readRecs = {};

    af.zclClusterAttrIdsReq(dstEp, cId).then(function (attrIds) {
        readRecs = _.map(attrIds, function (id) {
            return { attrId: id };
        });

        var attrsReqs = [],
        	attrs = {},
        	chunkSize = 8; // attributes count per chunk

        for(var i = 0; i < readRecs.length; i += chunkSize) {
            (function(chunk) {
            	attrsReqs.push(function () {               	
                	return af.zclFoundation(dstEp, dstEp, cId, 'read', chunk).then(function(readStatusRecsRsp) {          		
                		var payload = readStatusRecsRsp.payload;
                		// fix for statusCode
                        if(!payload.statusCode) { // when error { cmdId : id, statusCode : code }

                        	_.forEach(payload, function (rec) {  // { attrId, status, dataType, attrData }
                                var attrIdString = zclId.attr(cId, rec.attrId);

                                attrIdString = attrIdString ? attrIdString.key : rec.attrId;

                                attrs[attrIdString] = null;

                                if (rec.status === 0)
                                    attrs[attrIdString] = rec.attrData;
                            });
                        	
                        } else { // if error fill only attributes without values
                        	
                        	_.forEach(chunk, function (rec) {
                        		var attrIdString = zclId.attr(cId, rec.attrId);
                                attrIdString = attrIdString ? attrIdString.key : rec.attrId;
                                attrs[attrIdString] = null;
                        	});

                        }	
                	}); // return
                }); // push
            })(readRecs.slice(i, i + chunkSize)); // closure
        } // for
            
        var allReqs = attrsReqs.reduce(function (soFar, fn) {
            return soFar.then(fn);
        }, Q(0));

        allReqs.then(function () {
        	deferred.resolve(attrs);
        }).fail(function (err) {
        	deferred.reject(err);
        }).done();

    }).done();

    return deferred.promise.nodeify(callback);
};

