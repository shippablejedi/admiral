'use strict';

var self = initialize;
module.exports = self;

var async = require('async');
var _ = require('underscore');
var path = require('path');
var fs = require('fs');
var spawn = require('child_process').spawn;

var configHandler = require('../../common/configHandler.js');
var envHandler = require('../../common/envHandler.js');
var APIAdapter = require('../../common/APIAdapter.js');

function initialize(req, res) {
  var bag = {
    reqBody: req.body,
    res: res,
    resBody: {},
    component: 'workers',
    apiAdapter: new APIAdapter(req.headers.authorization.split(' ')[1]),
    params: {},
    skipStatusChange: false,
    isResponseSent: false,
    tmpScript: '/tmp/workers.sh',
    accessKeyEnv: 'ACCESS_KEY',
    secretKeyEnv: 'SECRET_KEY',
    swarmWorkerTokenEnv: 'SWARM_WORKER_JOIN_TOKEN',
    noVerifySSLEnv: 'NO_VERIFY_SSL'
  };

  bag.who = util.format('workers|%s', self.name);
  logger.info(bag.who, 'Starting');

  async.series([
      _checkInputParams.bind(null, bag),
      _get.bind(null, bag),
      _getMaster.bind(null, bag),
      _checkConfig.bind(null, bag),
      _setProcessingFlag.bind(null, bag),
      _sendResponse.bind(null, bag),
      _getAccessKey.bind(null, bag),
      _getSecretKey.bind(null, bag),
      _getNoVerifySSL.bind(null, bag),
      _getSwarmWorkerJoinToken.bind(null, bag),
      _getReleaseVersion.bind(null, bag),
      _getOperatingSystem.bind(null, bag),
      _getArchitecture.bind(null, bag),
      _generateInitializeEnvs.bind(null, bag),
      _generateInitializeScript.bind(null, bag),
      _writeScriptToFile.bind(null, bag),
      _initializeWorker.bind(null, bag),
      _post.bind(null, bag),
      _getMasterNodeId.bind(null, bag),
      _drainMaster.bind(null, bag)
    ],
    function (err) {
      logger.info(bag.who, 'Completed');
      if (!bag.skipStatusChange)
        _setCompleteStatus(bag, err);

      if (err) {
        // only send a response if we haven't already
        if (!bag.isResponseSent)
          respondWithError(bag.res, err);
        else
          logger.warn(err);
      }
      //TODO: remove tmp file
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  if (!_.has(bag.reqBody, 'address') || _.isEmpty(bag.reqBody.address))
    return next(
      new ActErr(who, ActErr.DataNotFound,
        'Missing body data :address')
    );

  bag.address = bag.reqBody.address;

  return next();
}

function _get(bag, next) {
  var who = bag.who + '|' + _get.name;
  logger.verbose(who, 'Inside');

  configHandler.get(bag.component,
    function (err, workers) {
      if (err)
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'Failed to get ' + bag.component, err)
        );

      if (_.isEmpty(workers))
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'No configuration in database for ' + bag.component)
        );

      bag.config = _.find(workers,
        function (worker) {
          return worker.address === bag.address;
        }
      );

      if (_.isEmpty(bag.config))
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'No entry in workers list for ' + bag.address)
        );
      bag.workers = workers;
      return next();
    }
  );
}

function _getMaster(bag, next) {
  var who = bag.who + '|' + _getMaster.name;
  logger.verbose(who, 'Inside');

  configHandler.get('master',
    function (err, master) {
      if (err)
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'Failed to get master', err)
        );

      if (_.isEmpty(master))
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'No configuration in database for master')
        );

      bag.master = master;
      return next();
    }
  );
}

function _checkConfig(bag, next) {
  var who = bag.who + '|' + _checkConfig.name;
  logger.verbose(who, 'Inside');

  var missingConfigFields = [];

  if (!_.has(bag.config, 'address') || _.isEmpty(bag.config.address))
    missingConfigFields.push('address');
  if (!_.has(bag.config, 'port') || !bag.config.port)
    missingConfigFields.push('port');

  if (missingConfigFields.length)
    return next(
      new ActErr(who, ActErr.DataNotFound,
        'Missing worker config data: ' + missingConfigFields.join())
    );

  return next();
}

function _setProcessingFlag(bag, next) {
  var who = bag.who + '|' + _setProcessingFlag.name;
  logger.verbose(who, 'Inside');

  _.each(bag.workers,
    function (worker) {
      if (worker.address === bag.config.address) {
        worker.isProcessing = true;
        worker.isFailed = false;
      }
    }
  );

  configHandler.put(bag.component, bag.workers,
    function (err) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Failed to update config for ' + bag.component, err)
        );

      return next();
    }
  );
}

function _sendResponse(bag, next) {
  var who = bag.who + '|' + _sendResponse.name;
  logger.verbose(who, 'Inside');

  // We reply early so the request won't time out while
  // waiting for the service to start.

  sendJSONResponse(bag.res, bag.resBody, 202);
  bag.isResponseSent = true;
  return next();
}

function _getAccessKey(bag, next) {
  var who = bag.who + '|' + _getAccessKey.name;
  logger.verbose(who, 'Inside');

  envHandler.get(bag.accessKeyEnv,
    function (err, accessKey) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: ' + bag.accessKeyEnv)
        );

      bag.accessKey = accessKey;
      logger.debug('Found access key');

      return next();
    }
  );
}

function _getSecretKey(bag, next) {
  var who = bag.who + '|' + _getSecretKey.name;
  logger.verbose(who, 'Inside');

  envHandler.get(bag.secretKeyEnv,
    function (err, secretKey) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: ' + bag.secretKeyEnv)
        );

      bag.secretKey = secretKey;
      logger.debug('Found secret key');

      return next();
    }
  );
}

function _getNoVerifySSL(bag, next) {
  var who = bag.who + '|' + _getNoVerifySSL.name;
  logger.verbose(who, 'Inside');

  envHandler.get(bag.noVerifySSLEnv,
    function (err, noVerifySSL) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: ' + bag.noVerifySSLEnv)
        );

      bag.noVerifySSL = noVerifySSL;

      return next();
    }
  );
}

function _getSwarmWorkerJoinToken(bag, next) {
  var who = bag.who + '|' + _getSwarmWorkerJoinToken.name;
  logger.verbose(who, 'Inside');

  envHandler.get(bag.swarmWorkerTokenEnv,
    function (err, swarmWorkerJoinToken) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: ' + bag.swarmWorkerTokenEnv)
        );

      if (_.isEmpty(swarmWorkerJoinToken))
        return next(
          new ActErr(who, ActErr.ParamNotFound,
            'empty env: ' + bag.swarmWorkerTokenEnv)
        );

      bag.swarmWorkerJoinToken = swarmWorkerJoinToken;
      return next();
    }
  );
}

function _getReleaseVersion(bag, next) {
  var who = bag.who + '|' + _getReleaseVersion.name;
  logger.verbose(who, 'Inside');

  var query = '';
  bag.apiAdapter.getSystemSettings(query,
    function (err, systemSettings) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Failed to get system settings : ' + util.inspect(err))
        );

      bag.releaseVersion = systemSettings.releaseVersion;

      return next();
    }
  );
}

function _getOperatingSystem(bag, next) {
  var who = bag.who + '|' + _getOperatingSystem.name;
  logger.verbose(who, 'Inside');

  envHandler.get('OPERATING_SYSTEM',
    function (err, operatingSystem) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: OPERATING_SYSTEM')
        );

      bag.operatingSystem = operatingSystem;
      logger.debug('Found Operating System');

      return next();
    }
  );
}

function _getArchitecture(bag, next) {
  var who = bag.who + '|' + _getArchitecture.name;
  logger.verbose(who, 'Inside');

  envHandler.get('ARCHITECTURE',
    function (err, architecture) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: ARCHITECTURE')
        );

      bag.architecture = architecture;
      logger.debug('Found Architecture');

      return next();
    }
  );
}

function _generateInitializeEnvs(bag, next) {
  var who = bag.who + '|' + _generateInitializeEnvs.name;
  logger.verbose(who, 'Inside');

  bag.scriptEnvs = {
    'ADMIRAL_IP': global.config.admiralIP,
    'RUNTIME_DIR': global.config.runtimeDir,
    'SSH_USER': global.config.sshUser,
    'SSH_PRIVATE_KEY': path.join(global.config.configDir, 'machinekey'),
    'SSH_PUBLIC_KEY': path.join(global.config.configDir, 'machinekey.pub'),
    'RELEASE': bag.releaseVersion,
    'CONFIG_DIR': global.config.configDir,
    'SCRIPTS_DIR': global.config.scriptsDir,
    'IS_INITIALIZED': bag.config.isInitialized,
    'IS_INSTALLED': bag.config.isInstalled,
    'WORKER_HOST': bag.config.address,
    'WORKER_PORT': bag.config.port,
    'MASTER_HOST': bag.master.address,
    'MASTER_PORT': bag.master.port,
    'WORKER_JOIN_TOKEN': bag.swarmWorkerJoinToken,
    'PRIVATE_IMAGE_REGISTRY': global.config.privateImageRegistry,
    'ACCESS_KEY': bag.accessKey,
    'SECRET_KEY': bag.secretKey,
    'NO_VERIFY_SSL': bag.noVerifySSL,
    'SHIPPABLE_HTTP_PROXY': process.env.http_proxy || '',
    'SHIPPABLE_HTTPS_PROXY': process.env.https_proxy || '',
    'SHIPPABLE_NO_PROXY': process.env.no_proxy || '',
    'ARCHITECTURE': bag.architecture,
    'OPERATING_SYSTEM': bag.operatingSystem
  };

  return next();
}

function _generateInitializeScript(bag, next) {
  var who = bag.who + '|' + _generateInitializeScript.name;
  logger.verbose(who, 'Inside');

  //attach header
  var filePath = path.join(global.config.scriptsDir, '/lib/_logger.sh');
  var headerScript = '';
  headerScript = headerScript.concat(__applyTemplate(filePath, bag.params));

  var helpers = headerScript;
  filePath = path.join(global.config.scriptsDir, '/lib/_helpers.sh');
  helpers = headerScript.concat(__applyTemplate(filePath, bag.params));

  var osArchitectureHelpers = helpers;
  filePath = path.join(global.config.scriptsDir, bag.architecture,
    bag.operatingSystem, '_helpers.sh');
  osArchitectureHelpers =
    osArchitectureHelpers.concat(__applyTemplate(filePath, bag.params));

  var initializeScript = osArchitectureHelpers;
  filePath = path.join(global.config.scriptsDir, 'installWorker.sh');
  initializeScript =
    initializeScript.concat(__applyTemplate(filePath, bag.params));

  bag.script = initializeScript;
  return next();
}

function _writeScriptToFile(bag, next) {
  var who = bag.who + '|' + _writeScriptToFile.name;
  logger.debug(who, 'Inside');

  fs.writeFile(bag.tmpScript,
    bag.script,
    function (err) {
      if (err) {
        var msg = util.format('%s, Failed with err:%s', who, err);
        return next(
          new ActErr(
            who, ActErr.OperationFailed, msg)
        );
      }
      fs.chmodSync(bag.tmpScript, '755');
      return next();
    }
  );
}


function _initializeWorker(bag, next) {
  var who = bag.who + '|' + _initializeWorker.name;
  logger.verbose(who, 'Inside');

  /* jshint camelcase:false */
  bag.scriptEnvs = bag.scriptEnvs || {};
  if (process.env.http_proxy)
    bag.scriptEnvs.http_proxy = process.env.http_proxy;

  if (process.env.https_proxy)
    bag.scriptEnvs.https_proxy = process.env.https_proxy;

  if (process.env.no_proxy)
    bag.scriptEnvs.no_proxy = process.env.no_proxy;
  /* jshint camelcase:true */

  var exec = spawn('/bin/bash',
    ['-c', bag.tmpScript],
    {
      env: bag.scriptEnvs
    }
  );

  exec.stdout.on('data',
    function (data)  {
      logger.debug(who, data.toString());
    }
  );

  exec.stderr.on('data',
    function (data)  {
      logger.error(who, data.toString());
    }
  );

  exec.on('close',
    function (exitCode)  {
      if (exitCode > 0)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Script returned code: ' + exitCode)
        );
      return next();
    }
  );
}

function _post(bag, next) {
  var who = bag.who + '|' + _post.name;
  logger.verbose(who, 'Inside');

  _.each(bag.workers,
    function (worker) {
      if (worker.address === bag.config.address) {
        worker.isInstalled = true;
        worker.isInitialized = true;
      }
    }
  );

  configHandler.put(bag.component, bag.workers,
    function (err, response) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Failed to update config for ' + bag.component, err)
        );

      bag.resBody = response;
      return next();
    }
  );
}

function _getMasterNodeId(bag, next) {
  var who = bag.who + '|' + _getMasterNodeId.name;
  logger.verbose(who, 'Inside');

  var command = 'sudo docker node ls -f "role=manager" -q';
  var exec = spawn('/bin/bash',
    ['-c', command]
  );

  exec.stdout.on('data',
    function (data)  {
      logger.debug(who, data.toString());
      bag.master.nodeId = data.toString();
      bag.master.nodeId = bag.master.nodeId.trim();
    }
  );

  exec.stderr.on('data',
    function (data)  {
      logger.error(who, data.toString());
    }
  );

  exec.on('close',
    function (exitCode)  {
      if (exitCode > 0)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Script returned code: ' + exitCode)
        );
      return next();
    }
  );
}

function _drainMaster(bag, next) {
  var who = bag.who + '|' + _drainMaster.name;
  logger.verbose(who, 'Inside');

  var command =
    util.format(
      'sudo docker node update --availability drain %s', bag.master.nodeId);
  var exec = spawn('/bin/bash',
    ['-c', command]
  );

  exec.stdout.on('data',
    function (data)  {
      logger.debug(who, data.toString());
      bag.workerJoinToken = data.toString();
      bag.workerJoinToken = bag.workerJoinToken.trim();
    }
  );

  exec.stderr.on('data',
    function (data)  {
      logger.error(who, data.toString());
    }
  );

  exec.on('close',
    function (exitCode)  {
      if (exitCode > 0)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Script returned code: ' + exitCode)
        );
      return next();
    }
  );
}

function _setCompleteStatus(bag, err) {
  var who = bag.who + '|' + _setCompleteStatus.name;
  logger.verbose(who, 'Inside');

  _.each(bag.workers,
    function (worker) {
      if (worker.address === bag.config.address) {
        worker.isProcessing = false;
        if (err)
          worker.isFailed = true;
        else
          worker.isFailed = false;
      }
    }
  );

  configHandler.put(bag.component, bag.workers,
    function (err) {
      if (err)
        logger.warn(err);
    }
  );
}

//local function to apply vars to template
function __applyTemplate(filePath, dataObj) {
  var fileContent = fs.readFileSync(filePath).toString();
  var template = _.template(fileContent);

  return template({obj: dataObj});
}
