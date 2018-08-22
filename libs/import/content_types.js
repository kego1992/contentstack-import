var mkdirp = require('mkdirp');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var Promise = require('bluebird');

var helper = require('../utils/helper');
var request = require('../utils/request');
var log = require('../utils/log');

var contentTypeConfig = config.modules.content_types;
var contentTypesFolderPath = path.resolve(config.data, contentTypeConfig.dirName);
var mapperFolderPath = path.join(config.data, 'mapper', 'content_types');
var skipFiles = ['__master.json', '__priority.json', 'schema.json'];
var fileNames = fs.readdirSync(path.join(contentTypesFolderPath));

function importContentTypes() {
  var self = this;

  this.contentTypes = [];
  for (var index in fileNames) {
    if (skipFiles.indexOf(fileNames[index]) === -1) {
      this.contentTypes.push(helper.readFile(path.join(contentTypesFolderPath, fileNames[index])));
    }
  }

  this.contentTypeUids = _.map(this.contentTypes, 'uid');
  this.createdContentTypeUids = [];
  if (!fs.existsSync(mapperFolderPath)) {
    mkdirp.sync(mapperFolderPath);
  }
  // avoid re-creating content types that already exists in the stack
  if (fs.existsSync(path.join(mapperFolderPath, 'success.json'))) {
    this.createdContentTypeUids = helper.readFile(path.join(mapperFolderPath, 'success.json')) || [];
  }
  this.contentTypeUids = _.difference(this.contentTypeUids, this.createdContentTypeUids);
  // remove contet types, already created
  _.remove(this.contentTypes, function (contentType) {
    return self.contentTypeUids.indexOf(contentType.uid) === -1;
  });
  this.schemaTemplate = require('../utils/schemaTemplate');
  this.requestOptions = {
    uri: client.endPoint + config.apis.content_types,
    headers: {
      api_key: config.target_stack,
      authtoken: client.authtoken
    },
    method: 'POST',
    json: {}
  };
}

importContentTypes.prototype = {
  start: function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      return Promise.map(self.contentTypeUids, function (contentTypeUid) {
        return self.seedContentTypes(contentTypeUid).then(function () {
          return;
        }).catch(function (error) {
          log.error('Failed to create ' + contentTypeUid + '. Please check error logs for more details');
          // unable to seed content type
          throw error;
        });
      }, {
        // seed 3 content types at a time
        concurrency: 3
      }).then(function () {
        // content type seeidng completed
        self.requestOptions.method = 'PUT';
        return Promise.map(self.contentTypes, function (contentType) {
          return self.updateContentTypes(contentType).then(function () {
            log.success(contentType.uid + ' was updated successfully!');
            return;
          }).catch(function (error) {
            log.error('Failed to update ' + contentType.uid + ' check error logs for more details');
            // unable to seed content type
            throw error;
          });
        }).then(function () {
          log.success('Content types have been imported successfully!');
          // content types have been successfully imported
          return resolve();
        }).catch(function (error) {
          // error while updating content types
          return reject(error);
        });
      }).catch(function (error) {
        // failed to seed content types
        return reject(error);
      });
    });
  },
  seedContentTypes: function (uid) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var body = _.cloneDeep(self.schemaTemplate);
      body.content_type.uid = uid;
      body.content_type.title = uid;
      var requestObject = _.cloneDeep(self.requestOptions);
      requestObject.json = body;
      return request(requestObject).then(function () {
        // content type has been created successfully
        return resolve();
      }).catch(function (error) {
        if (error.error_code === 115 && (error.errors.uid || error.errors.title)) {
          // content type uid already exists
          return resolve();
        }
        return reject(error);
      });
    });
  },
  updateContentTypes: function (contentType) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var requestObject = _.cloneDeep(self.requestOptions);
      requestObject.uri += contentType.uid;
      requestObject.json.content_type = contentType;
      return request(requestObject).then(function (response) {
        self.createdContentTypeUids.push(response.body.content_type.uid);
        helper.writeFile(path.join(mapperFolderPath, 'success.json'), self.createdContentTypeUids);
        return resolve();
      }).catch(function (error) {
        // error while updating content type
        return reject(error);
      });
    });
  }
};

module.exports = new importContentTypes();