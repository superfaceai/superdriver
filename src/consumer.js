//
//  Proof of concept of a profile-consuming API client
//  --------------------------------------------------
//
//  This client is generic, meaning it has no notion of any domain neither it is programmed for a particular service.
//  Instead, it relies on ALPS profile and OpenAPI Specification to figure out what HTTP call needs to be done.
//  In theory, the client can be changed to use many protocols and API styles at the same type and not just HTTP.
//
const superagent = require('superagent');

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
    console.log('---> invoking ', request.operation, request.parameters, this.providerURL);

    // Fetch OpenAPI Specification (if not already)
    await this.fetchAPISpecification();

    // Find in OpenAPI Specification the operation with given Profile's affordance id
    const operation = this.findOperation(request.operation);

    // Build HTTP request according to OpenAPI Specification and Profile request
    const httpRequest = this.buildRequest(operation, request.parameters);

    // Execute the request
    const httpResponse = await this.execute(httpRequest);

    // Normalize the response, translating it from the HTTP response to Profile
    const profileResponse = this.normalizeResponse(operation, httpResponse, request.response);

    return Promise.resolve(profileResponse);
  }

  /**
   * Fetch OAS from the provider
   */
  async fetchAPISpecification() {
    if (!this.apiSpecification) {
      // Use provided mapping URL or hard-code guess
      const specificationURL = (this.mappingURL && this.mappingURL.length) ? this.mappingURL : `${this.providerURL}/oas`; 

      // Make the call
      try {
        const response =
          await superagent
            .get(specificationURL)
            .set('accept', 'application/json');
        this.apiSpecification = response.body;
      }
      catch (e) {
        // console.error(e);
        return Promise.reject(e);
      };
    }

    return Promise.resolve(this.apiSpecification);
  }

  /**
   * Find operation with given x-profile affordanceId
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
          // Find response schema
          let responseSchema = null;
          for (const responseCode in operation.responses) {
            if (responseCode[0] === '2') {
              responseSchema = operation.responses[responseCode].content['application/json'].schema; // TODO: Don't assume content type
            }
          }
          // console.log('response schema', responseSchema)

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
   * @param {String} operation 
   * @param {Object} parameters 
   */
  buildRequest(operation, parameters) {
    const url = `${this.providerURL}${operation.url}`;
    const method = operation.method;
    let headers = {};
    let query = [];
    let body = null;

    // Fully qualified the input parameters
    let inputParameters = {}
    for (const parameterId in parameters) {
      inputParameters[`${this.profileId}#${parameterId}`] = parameters[parameterId];
    }
    //console.log('fully qualified input parameters\n', inputParameters);

    //
    // Process OAS parameters
    //
    if (operation.details.parameters) {
      operation.details.parameters.forEach(parameter => {
        const fullParmeterId = parameter['x-profile'];
        if (fullParmeterId in inputParameters) {
          // console.log(`processing parameter...\n`, parameter);

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
    if (operation.details.requestBody) {
      // TODO: do not blindly assume application/json of object type
      const schema = operation.details.requestBody.content['application/json'].schema;
      headers['content-type'] = 'application/json'
      body = {};

      // Naive, flat traversal
      // TODO: revisit for real objects
      const schemaProperties = schema.properties;
      for (const propertyKey in schemaProperties) {
        if (schemaProperties[propertyKey]['x-profile']) {
          const propertyId = schemaProperties[propertyKey]['x-profile'];
          if (propertyId in inputParameters) {
            body[propertyKey] = inputParameters[propertyId];
          }
        }
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
    console.log(`\n${request.method.toUpperCase()} ${request.url}${(request.query.length) ? '?' + request.query.join('&') : ''}`);
    console.log(`headers:`, JSON.stringify(request.headers));
    if (request.body)
      console.log(`body:`, JSON.stringify(request.body))
    console.log();

    try {
      let response =
        await superagent(
          request.method,
          request.url)
          .query(request.query.join('&'))
          .set(request.headers)
          .send(request.body);

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
    // Fully qualify the requested response
    let qualifiedProperties = [];
    requestedResponse.forEach((element) => {
      qualifiedProperties.push(`${this.profileId}#${element}`);
    });

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

module.exports = Consumer;
