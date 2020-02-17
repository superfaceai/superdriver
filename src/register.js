import fetch from 'isomorphic-fetch';
import Debug from 'debug';
const debug = Debug('superdriver:register');

const CONFLICT_RELATION_KEY = 'conflictUrl';

const DEFAULT_OPTIONS = {
  fetch: fetch
}

export class Register {
  /**
   * Service Register proxy
   *
   * @param {String} registerUrl URL of the register to use
   * @param {Object} options
   * @param {Function} options.fetch custom implementation of fetch
   */
  constructor(registerUrl, options) {
    this.registerUrl = registerUrl;
    this.options     = Object.assign(DEFAULT_OPTIONS, options)
  }

  /**
   * Find services in the register that conform to a profile
   *
   * @param {String} profileId Id of the profile the matching sarvice has to support
   */
  async findServices(profileId) {
    const response = await this.options.fetch(
      `${this.registerUrl}/api/registry?semanticProfile=${encodeURIComponent(profileId)}`,  // TODO: use superdriver instead of hard-coding URLs
      {
        headers: {
          'Accept': 'application/json'
        },
        redirect: 'follow',
      }
    )

    const body = await response.json()
    const services = body['disco'];

    if (!services || !services.length) {
      return Promise.reject(`No service for profile '${profileId}' found.`)
    }

    return services;
  }

  /**
   * Register a new service at the registry
   *
   * @param {Object} param0 Service details*
   * @param {string} param0.serviceUrl Url of the service being registered
   * @param {string} param0.mappingUrl Url of the mapping for the registered service
   * @param {string} param0.semanticProfile Id of the semantic profile
   * @returns {object} Representation of registered service
   */
  async registerService({ serviceUrl, mappingUrl, semanticProfile }) {
    debug('registering service', serviceUrl)
    const response = await this.options.fetch(
      `${this.registerUrl}/api/registry`,
      {
        method: 'POST',
        cache: 'no-cache',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        redirect: 'follow',
        body: JSON.stringify({ serviceUrl, mappingUrl, semanticProfile })
      }
    )

    const body = await response.json()
    // Return created service
    if (response.ok) {
      return {
        result: 'created',
        service: body
      };
    }

    // Handle conflicts
    if (response.status == 409 && (CONFLICT_RELATION_KEY in body)) {
      const conflictUrl = body[CONFLICT_RELATION_KEY]
      if (!conflictUrl) {
        return Promise.reject({ result: 'failed', status: response.status, detail: body })
      }

      // Fetch conflicting service
      debug('fetching conflicting service ', conflictUrl)
      const conflictResponse = await this.options.fetch(
        `${this.registerUrl}${conflictUrl}`,
        {
          headers: {
            'Accept': 'application/json'
          },
          redirect: 'follow',
        }
      )
      // Return created service
      const conflictBody = await conflictResponse.json()
      if (conflictResponse.ok) {
        return {
          result: 'conflict',
          service: conflictBody
        };
      }

      return Promise.reject({ result: 'failed-conflict', status: conflictResponse.status, detail: conflictBody })
    }

    return Promise.reject({ result: 'failed', status: response.status, detail: body })
  }

  /**
   *  Unregister a previous registered service
   *
   * @param {Object} param0 Service details
   */
  async unregisterService({ serviceUrl }) {
    debug('unregistering service', serviceUrl)

    const response = await this.options.fetch(
      `${this.registerUrl}${serviceUrl}`,
      {
        method: 'DELETE',
        cache: 'no-cache',
        headers: {
          'Accept': 'application/json'
        },
        redirect: 'follow'
      }
    )

    if (response.ok) {
      return
    }

    const body = await response.json()
    return Promise.reject({ result: 'failed', status: response.status, detail: body })
  }
}
