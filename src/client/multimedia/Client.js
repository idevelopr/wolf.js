const axios = require('axios');
const { aws4Interceptor } = require('aws4-axios');

const AWS = require('aws-sdk');
const { Event } = require('../../constants');
const Response = require('../../models/Response');

class Client {
  constructor (client) {
    this.client = client;

    this.credentialProvider = {
      getCredentials: async () => {
        if (AWS.config.credentials && !AWS.config.credentials.needsRefresh()) {
          return AWS.config.credentials;
        }

        const cognito = await this.client.getSecurityToken(true);

        if (!AWS.config.credentials) {
          AWS.config.credentials = new AWS.CognitoIdentityCredentials(
            {
              IdentityId: cognito.identity,
              Logins: {
                'cognito-identity.amazonaws.com': cognito.token
              }
            },
            {
              region: 'eu-west-1'
            }
          );

          return await new Promise((resolve, reject) => {
            AWS.config.getCredentials(function (error) {
              if (error) {
                this.client.emit(Event.INTERNAL_ERROR, error);
                reject(error);
              } else {
                resolve(AWS.config.credentials);
              }
            });
          });
        }

        AWS.config.credentials.params.Logins['cognito-identity.amazonaws.com'] = cognito.token;

        return await new Promise((resolve, reject) => {
          AWS.config.credentials.refresh(function (error) {
            if (error) {
              this.client.emit(Event.INTERNAL_ERROR, error);
              reject(error);
            } else {
              resolve(AWS.config.credentials);
            }
          });
        });
      }
    };
  }

  async upload (route, body) {
    const interceptor = aws4Interceptor(
      {
        region: 'eu-west-1',
        service: 'execute-api'
      },
      this.credentialProvider
    );

    axios.interceptors.request.use(interceptor);

    return await new Promise((resolve, reject) => {
      axios.post(`${this.client.endpointConfig.mmsUploadEndpoint}/v${route.version}/${route.path}`, { body })
        .then((res) => resolve(new Response(res.data)))
        .catch((error) => reject(error));
    });
  }
}

module.exports = Client;