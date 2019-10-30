//
//  Proof of concept of a profile-consuming API client
//  --------------------------------------------------
//
//  This client is generic, meaning it has no notion of any domain neither it is programmed for a particular service.
//  Instead, it relies on ALPS profile and OpenAPI Specification to figure out what HTTP call needs to be done.
//  In theory, the client can be changed to use many protocols and API styles at the same type and not just HTTP.
//
const superagent = require('superagent');
const debug = require('debug')('superdriver:consumer');
const SwaggerParser = require("swagger-parser");

class Consumer {

  /**
   * Superdriver profile consumer' constructor
   * 
   * @param {String} providerURL Provider URL – API root
   * @param {String} profileId Profile identifier
   * @param {String} mappingURL Optional mapping URL
   */
  constructor(providerURL, profileId, mappingURL) {
    this.providerURL = providerURL;
    this.profileId = profileId;
    this.mappingURL = mappingURL;
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
        const response =
          await superagent
            .get(specificationURL)
            .set('accept', 'application/json');

        if (response.noContent || !response.body) {
          return Promise.reject('No API specification found');
        }

        this.apiSpecification = await SwaggerParser.dereference(response.body);
        debug(`  retrieved API specification (${response.text.length}B)`);
      }
      catch (e) {
        return Promise.reject(e);
      };
    }

    return Promise.resolve(this.apiSpecification);
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

      // Iterate operations
      for (const operationKey in path) {
        const operation = path[operationKey];

        if (operation['x-profile'] === fullProfileAffordanceId) {
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
    const url = `${this.providerURL}${oasOperation.url}`;
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
        const fullParmeterId = parameter['x-profile'];
        if (fullParmeterId in inputParameters) {
          // debug(`processing parameter...\n`, parameter);

          if (parameter.in === 'query') {
            // Query parameters
            query.push(`${parameter.name}=${inputParameters[fullParmeterId]}`);  //TODO: pct-escape value
          }
          else {
            console.error(`parameters in '${parameter.in}' are not supported, yet`);
          }
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
        const schemaProperties = oasOperation.details.requestBody.content[mediaType].schema.properties;
        for (const propertyKey in schemaProperties) {
          if (schemaProperties[propertyKey]['x-profile']) {
            const propertyId = schemaProperties[propertyKey]['x-profile'];
            if (propertyId in inputParameters) {
              requestContentType.body[propertyKey] = inputParameters[propertyId];
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

    // TODO: Process other elements like headers, consumes / produces and authentication

    // Always accept JSON
    headers['accept'] = 'application/json';

    return { url, method, query, headers, body };
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
      let response =
        await superagent(
          request.method,
          request.url)
          .query(request.query.join('&'))
          .set(request.headers)
          .send(request.body);

      debug('http response:', response.body);
      return Promise.resolve(response.body);
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
      const index = qualifiedProperties.indexOf(schemaProperties[property]['x-profile']);
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

module.exports = Consumer;
