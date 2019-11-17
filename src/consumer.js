//
//  Proof of concept of a profile-consuming API client
//  --------------------------------------------------
//
//  This client is generic, meaning it has no notion of any domain neither it is programmed for a particular service.
//  Instead, it relies on ALPS profile and OpenAPI Specification to figure out what HTTP call needs to be done.
//  In theory, the client can be changed to use many protocols and API styles at the same type and not just HTTP.
//
import Debug from 'debug';
import fetch from 'isomorphic-fetch'
import SwaggerParser from 'swagger-parser'
import * as base64 from './base64'

const debug = Debug('superdriver:consumer');

const OAS_PROFILE_KEY = 'x-profile';
const OAS_SUPER_KEY = 'x-super';
const OAS_SUPER_SOURCE_KEY = 'source';
const OAS_SUPER_VALUE_KEY = 'value';

const OAS_SOURCE = {
  basic: {
    user: 'security-basic-user',
    password: 'security-basic-password',
  },
  apikey: {
    key: 'security-apikey-key',
    secret: 'security-apikey-secret'
  }
}

export class Consumer {
  /**
   * Superdriver profile consumer' constructor
   *
   * @param {Object} service Information about the provider service
   * @param {String} service.serviceURL Service URL
   * @param {String} service.profileId Profile identifier
   * @param {String} service.mappingURL Optional mapping URL
   * @param {Object} service.authentication Optional Credentials for authentication
   */
  constructor(service) {
    this.providerURL = service.serviceURL;
    this.profileId = service.profileId;
    this.mappingURL = service.mappingURL;
    this.authentication = service.authentication;
  }

  /**
   * Invoke a profile's affordance identified in the request
   *
   * @param {Object} request Request object for the affordance to perform
   * @param {String} request.operation Identifier of the affordance – operation to invoke as defined in the used ALPS profile
   * @param {Object} request.parameters Dictionary of request input parameters as defined in the used ALPS profile
   * @param {Array<String>} request.response Array of desired response properties as defined in the used ALPS profile
   *
   * @return {Promise}
   */
  async perform(request) {
    debug(`performing '${request.operation}' for ${this.providerURL} service`);
    debug(`  parameters: ${JSON.stringify(request.parameters)}`);
    debug(`  expected response: ${JSON.stringify(request.response)}`);

    // Fetch OpenAPI Specification (if not already)
    await this.fetchAPISpecification();

    // Find in OpenAPI Specification the operation with given Profile's affordance id
    const oasOperation = this.findOperation(request.operation);
    if (!oasOperation) {
      return Promise.reject(`No operation found for '${request.operation}`);
    }

    // Build HTTP request according to OpenAPI Specification and Profile request
    const httpRequest = this.buildRequest(request.operation, oasOperation, request.parameters);

    // Execute the request
    const httpResponse = await this.execute(httpRequest);

    // Normalize the response, translating it from the HTTP response to Profile
    const profileResponse = this.normalizeResponse(oasOperation, httpResponse, request.response);

    debug('result:', profileResponse);

    return Promise.resolve(profileResponse);
  }

  /**
   * Fetch OAS from the provider
   */
  async fetchAPISpecification() {
    if (!this.apiSpecification) {
      // Use provided mapping URL or hard-code guess
      const specificationURL = (this.mappingURL && this.mappingURL.length) ? this.mappingURL : `${this.providerURL}/oas`;
      debug(`fetching API specification from ${specificationURL}`);

      // Make the call
      try {
        const response = await fetch(specificationURL, {
          headers: {
            'Accept': 'application/json'
          }
        })

        // TODO: handle empty state better
        const body = await response.json()

        if (!response.body) {
          return Promise.reject('No API specification found');
        }

        this.apiSpecification = await SwaggerParser.dereference(body);
        debug(`  retrieved API specification (${response.text.length}B)`);
      }
      catch (e) {
        return Promise.reject(e);
      };
    }

    return this.apiSpecification;
  }

  /**
   * Find operation with given x-profile affordance id
   *
   * @param {String} affordanceId
   */
  findOperation(affordanceId) {
    if (!this.apiSpecification || !this.profileId) {
      return null;
    }
    // Full id of the affordance within the profile
    const fullProfileAffordanceId = `${this.profileId}#${affordanceId}`;

    // Iterate paths
    for (const pathKey in this.apiSpecification.paths) {
      const path = this.apiSpecification.paths[pathKey];
      debug('path', pathKey, path);

      // Iterate operations
      for (const operationKey in path) {
        const operation = path[operationKey];

        if (operation[OAS_PROFILE_KEY] === fullProfileAffordanceId) {
          debug(`found operation mapping`);

          // Find response schema
          let responseSchema = null;
          for (const responseCode in operation.responses) {
            if (responseCode[0] === '2') {
              if (operation.responses[responseCode].content && operation.responses[responseCode].content['application/json'] && operation.responses[responseCode].content['application/json'].schema)
                responseSchema = operation.responses[responseCode].content['application/json'].schema; // TODO: Don't assume content type
            }
          }
          debug(`  operation response schema: ${responseSchema ? 'yes' : 'no'}`);

          // Return operation data
          return {
            url: pathKey,
            method: operationKey,
            details: operation,
            responseSchema
          };
        }
      }
    };

    debug(`  no operation found for '${affordanceId}'`); // TODO: throw / reject
    return null;
  }

  /**
   * Build the request from operation information and parameters
   *
   * @param {String} affordanceId
   * @param {String} oasOperation
   * @param {Object} parameters
   */
  buildRequest(affordanceId, oasOperation, parameters) {
    let url = `${this.providerURL}${oasOperation.url}`;
    const method = oasOperation.method;
    let headers = {};
    let query = [];
    let body = null;

    // Fully qualified the input parameters
    let inputParameters = {}
    for (const parameterId in parameters) {
      inputParameters[`${this.profileId}#${affordanceId}/${parameterId}`] = parameters[parameterId];
    }
    debug('fully qualified input parameters:', JSON.stringify(inputParameters));

    //
    // Process OAS parameters
    //
    if (oasOperation.details.parameters) {
      oasOperation.details.parameters.forEach(parameter => {
        // debug(`processing parameter...\n`, parameter);

        // is parameter required?
        const isRequired = ('required' in parameter) ? parameter.required : false;

        // what is parameter full profile id?
        const fullParameterId = (OAS_PROFILE_KEY in parameter) ? parameter[OAS_PROFILE_KEY] : undefined;

        // is parameter provided in user's input?
        const isProvided = (fullParameterId && (fullParameterId in inputParameters)) ? true : false;

        // parameter value if provided
        let parameterValue = undefined;
        if (isProvided) {
          parameterValue = inputParameters[fullParameterId];
        }

        // try super metadata
        if (!isProvided && (OAS_SUPER_KEY in parameter)) {
          if (OAS_SUPER_SOURCE_KEY in parameter[OAS_SUPER_KEY]) {
            // Find the source of value and use it
            if (parameter[OAS_SUPER_KEY][OAS_SUPER_SOURCE_KEY] === OAS_SOURCE.basic.user) {
              if (this.authentication && ('basic' in this.authentication))
                parameterValue = this.authentication['basic'].user; // Use authentication user as the value
            }
          }
          else if (OAS_SUPER_VALUE_KEY in parameter[OAS_SUPER_KEY]) {
            // Use mapping-provided value directly
            parameterValue = parameter[OAS_SUPER_KEY][OAS_SUPER_VALUE_KEY];
          }
        }
        //debug(`  is required ${isRequired}, profile id: ${fullParameterId}, provided: ${isProvided}, value: ${parameterValue}`);

        if (isProvided || parameterValue) {
          if (parameter.in === 'query') {
            // Query parameters
            query.push(`${parameter.name}=${parameterValue}`);
          }
          else {
            // Brute-force replace
            url = url.replace(`{${parameter.name}}`, parameterValue); // Consider proper RFC6570, tooling
          }
        }
        else if (isRequired) {
          console.error(`required parameter '${parameter.name}' (profile id: '${fullParameterId}') not provided`);
          return null;
        }
      });
    }

    //
    // Process OAS requestBody
    //
    if (oasOperation.details.requestBody) {
      // Iterate available request media types
      let requestContentTypes = [];
      for (const mediaType in oasOperation.details.requestBody.content) {
        debug(`request media type: '${mediaType}'`);

        if (mediaType !== 'application/json' &&
          mediaType !== 'application/x-www-form-urlencoded') {
          debug('the request media type not yet supported, please contact makers');
          return null;
        }

        const requestContentType = {
          mediaType: mediaType,
          body: {}
        };

        // TODO: Naive, flat traversal, revisit for real objects
        // TODO: validate if a property is required
        const schemaProperties = oasOperation.details.requestBody.content[mediaType].schema.properties;
        for (const propertyKey in schemaProperties) {
          if (schemaProperties[propertyKey][OAS_PROFILE_KEY]) {
            const propertyId = schemaProperties[propertyKey][OAS_PROFILE_KEY];
            if (propertyId in inputParameters) {
              requestContentType.body[propertyKey] = inputParameters[propertyId];
            }
          }
          else if (schemaProperties[propertyKey][OAS_SUPER_KEY]) {
            // Check if source of the value parameter value is specified
            if (schemaProperties[propertyKey][OAS_SUPER_KEY].source === OAS_SOURCE.apikey.key) {
              // Source of the value is apikey's key
              if (this.authentication && ('apikey' in this.authentication))
                requestContentType.body[propertyKey] = this.authentication['apikey'].key;
            }
            else if (schemaProperties[propertyKey][OAS_SUPER_KEY].source === OAS_SOURCE.apikey.secret) {
              // Source of the value is apikey's secret
              if (this.authentication && ('apikey' in this.authentication))
                requestContentType.body[propertyKey] = this.authentication['apikey'].secret;
            }
          }
        }
        requestContentTypes.push(requestContentType);
      }
      if (requestContentTypes.length) {
        // TODO: Happy case – pick the first supported media type
        headers['content-type'] = requestContentTypes[0].mediaType;
        body = requestContentTypes[0].body;
      }
    }

    //
    // Process OAS Security
    //
    let security = [];
    if (oasOperation.details.security) {
      // Sanity check
      if (!this.apiSpecification.components || !this.apiSpecification.components.securitySchemes) {
        debug.error('security specified but no security components found');
        return null;
      }
      const securityComponent = this.apiSpecification.components.securitySchemes;
      // debug(securityComponent);

      // Pick the security id
      const operationSecurity = oasOperation.details.security;
      operationSecurity.forEach(item => {
        const securityId = Object.keys(item)[0];
        // debug('procesing security ID:', securityId);

        // Figure out what schema the security id is
        if (!(securityId in securityComponent)) {
          debug(`security '${securityId}' is not defined in security components`);
          return null;
        }
        const securityType = securityComponent[securityId].scheme;
        debug('security type:', securityType);
        security.push(securityType);
      });

    }

    // TODO: Process other elements like headers, consumes / produces

    // Always accept JSON
    headers['accept'] = 'application/json';

    return { url, method, query, headers, body, security };
  }

  //
  // Execute request
  //
  async execute(request) {
    // Log the request we are making
    debug(`${request.method.toUpperCase()} ${request.url}${(request.query.length) ? '?' + request.query.join('&') : ''}`);
    debug(`  headers:`, JSON.stringify(request.headers));

    if (request.body)
      debug(`  body:`, JSON.stringify(request.body))

    try {
      // Method and URL
      let url = request.url

      if (request.query) {
        if (url.includes('?')) {
          url = `${url}&${request.query.join('&')}`
        } else {
          url = `${url}?${request.query.join('&')}`
        }
      }

      // Authentication
      if (request.security && request.security.length) {
        const securityId = request.security[0]; // Pick first available

        if (!(securityId in this.authentication)) {
          return Promise.reject(`security '${securityId}' credentials not provided`);
        }

        const security = this.authentication[securityId]

        if (securityId === 'basic') {
          debug('  basic auth:', security.user); // do not log password!

          request.headers['Authorization'] = `Basic ${base64.encode(security.user + ":" + security.password)}`
        }
        else {
          return Promise.reject(`security '${securityId}' not yet supported, contact makers`);
        }
      }

      const response = await fetch(url, {
        body:    request.body,
        headers: request.headers,
        method:  request.method,
      });

      debug('http response:', response.body);
      return response.json()
    }
    catch (e) {
      return Promise.reject(e);
    }
  }

  //
  // Normalizes the response to the profile
  //
  normalizeResponse(operation, response, requestedResponse) {
    // Sanity check
    if (!operation.responseSchema) {
      debug('no response mapping');
      return null;
    }

    // Fully qualify the requested response
    let qualifiedProperties = [];
    requestedResponse.forEach((element) => {
      qualifiedProperties.push(`${this.profileId}#${element}`);
    });
    debug('fully qualified response properties', qualifiedProperties);

    // Naive, flat traversal
    // TODO: revisit for real objects
    const result = {}
    const schemaProperties = operation.responseSchema.properties;
    for (const property in schemaProperties) {
      const index = qualifiedProperties.indexOf(schemaProperties[property][OAS_PROFILE_KEY]);
      if (index >= 0) {
        result[requestedResponse[index]] = response[property];
      }
    }

    return result;
  }
};

// function IsEmptyObject(obj) {
//   return Object.keys(obj).length === 0;
// }
