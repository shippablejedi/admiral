'use strict';

var self = getStatus;
module.exports = self;

var async = require('async');
var _ = require('underscore');

var configHandler = require('../../common/configHandler.js');
var envHandler = require('../../common/envHandler.js');
var VaultAdapter = require('../../common/VaultAdapter.js');

function getStatus(req, res) {
  var bag = {
    reqQuery: req.query,
    resBody: {
      isReachable: false,
      error: null
    },
    vaultTokenEnv: 'VAULT_TOKEN',
    component: 'secrets'
  };

  bag.who = util.format('secrets|%s', self.name);
  logger.info(bag.who, 'Starting');

  async.series([
    _checkInputParams.bind(null, bag),
    _get.bind(null, bag),
    _getVaultToken.bind(null, bag),
    _createClient.bind(null, bag),
    _getStatus.bind(null, bag)
  ],
    function (err) {
      logger.info(bag.who, 'Completed');
      if (err)
        return respondWithError(res, err);

      sendJSONResponse(res, bag.resBody);
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  return next();
}

function _get(bag, next) {
  var who = bag.who + '|' + _get.name;
  logger.verbose(who, 'Inside');

  configHandler.get(bag.component,
    function (err, secrets) {
      if (err)
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'Failed to get ' + bag.component, err)
        );

      if (_.isEmpty(secrets))
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'No configuration in database for ' + bag.component)
        );

      bag.vaultUrl = util.format('http://%s:%s', secrets.address, secrets.port);
      return next();
    }
  );
}

function _getVaultToken(bag, next) {
  var who = bag.who + '|' + _getVaultToken.name;
  logger.verbose(who, 'Inside');

  envHandler.get(bag.vaultTokenEnv,
    function (err, vaultToken) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: ' + bag.vaultTokenEnv)
        );

      if (_.isEmpty(vaultToken))
        return next(
          new ActErr(who, ActErr.DataNotFound,
            'No vault token found')
        );

      logger.debug('Found vault token');
      bag.vaultToken = vaultToken;
      return next();
    }
  );
}

function _createClient(bag, next) {
  var who = bag.who + '|' + _createClient.name;
  logger.debug(who, 'Inside');

  bag.vaultAdapter = new VaultAdapter(bag.vaultUrl, bag.vaultToken);

  return next();
}

function _getStatus(bag, next) {
  var who = bag.who + '|' + _getStatus.name;
  logger.verbose(who, 'Inside');

  bag.vaultAdapter.getHealth(
    function (err, response) {
      if (err && err.code === 'ECONNREFUSED') {
        bag.resBody.isReachable = false;
        bag.resBody.error = util.inspect(err);
      } else if (err) {
        bag.resBody.isReachable = true;
        bag.resBody.error = util.inspect(err);
        bag.resBody = _.extend(bag.resBody, response);
      } else {
        bag.resBody.isReachable = true;
        bag.resBody = _.extend(bag.resBody, response);
      }

      return next();
    }
  );
}
