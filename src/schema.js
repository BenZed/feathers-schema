import is from 'is-explicit'

import * as validates from './validators'
import * as sanitizes from './sanitizers'

import { sanitizeAndValidate } from './hooks'
import { getIn, setIn, isPlainObject } from './helper'
import deepFreeze from 'deep-freeze'

/******************************************************************************/
// Options
/******************************************************************************/

const DEFAULT_OPTIONS = {
  fillPatchData: false,
  canSkipValidation: () => false
}

/******************************************************************************/
// Defintions
/******************************************************************************/

function addCustom(defs, key, arr) {
  if (key in defs === false)
    return

  const def = defs[key]

  const custom = is(def, Array) ? def : [def]
  arr.push(...custom)

}

function addStock(def, stock, arr) {
  for (const key in stock)
    if (key in def)
      arr.push(stock[key](def[key]))

}

function createProperty(schema, definition, path) {

  //cast path to arrayOf if it isn't already
  if (!is(path, Array))
    path = [path]

  //account for arrayOf in quick or plain notation
  const arrayOf = is(definition, Array)
  if (arrayOf && definition.length !== 1)
    throw new Error('Malformed definition. Properties defined as an arrayOf should contain a single element.')
  if (arrayOf)
    definition = definition[0]

  //account for quick notation
  if (is(definition, Function))
    definition = { type: { func: definition, arrayOf } }

  //convert type plain notation to explicit notation to ensure arrayOf is respected
  else if (is(definition.type, Function))
    definition.type = { func: definition.type, arrayOf }

  //ensure quick, plain, implicit or explicit notation satisfied
  if (!isPlainObject(definition))
    throw new Error('Malformed definition. Check feathers-schema documentation to learn how.')

  //get stock and custom validators
  const validators = []

  addStock(definition, validates, validators)
  addCustom(definition, 'validates', validators)
  addCustom(definition, 'validate', validators)

  //get stock and custom sanitizer
  const sanitizers = []

  addStock(definition, sanitizes, sanitizers)
  addCustom(definition, 'sanitizes', sanitizers)
  addCustom(definition, 'sanitize', sanitizers)

  const noFuncs = sanitizers.length + validators.length === 0
  const createNested = noFuncs && Object.keys(definition).length > 0
  if (createNested && !arrayOf) {
    for (const key in definition)
      createProperty(schema, definition[key], [...path, key])

    return
  } else if (createNested && arrayOf) {
    throw new Error('Nesting arrays of properties not yet implemented.')

  } else if (noFuncs)
    throw new Error('Malformed definition: Definition passed with no properties.')

  schema.properties.push({
    path,
    validators,
    sanitizers
  })

}

/******************************************************************************/
// Exports
/******************************************************************************/

export default class Schema {

  constructor(properties, options) {

    //Check options
    if (is(options) && !isPlainObject(options))
      throw new Error('options, if supplied, is expected to be a plain object.')

    this.options = { ...DEFAULT_OPTIONS, ...(options || {})}

    if (is(this.options.canSkipValidation, Boolean))
      this.options.canSkipValidation = () => this.options.canSkipValidation

    if (!is(this.options.canSkipValidation, Function))
      throw new Error('Schema options.canSkipValidation is expected to be a boolean or a predicate function.')

    //Create properties
    if (!isPlainObject(properties))
      throw new Error('A model must be created with a model properties object.')

    for (const path in properties)
      createProperty(this, properties[path], path)

    deepFreeze(this)
  }

  async sanitize(data = {}, params = {}) {

    //use a new object for the returned data, rather than mutating the provided one
    //this ensures that no data will be passed that isn't defined in the schema
    const sanitized = {}

    for (const { path, sanitizers } of this.properties) {

      //for each path in the schema, get the equivalent value in the hook data,
      //consolidating empty or undefined values to null
      let value = getIn(data, path)
      if (value === undefined || value === '')
        value = null

      for (const sanitizer of sanitizers)
        //run the value through all of the sanitizers in this path
        value = await sanitizer(value, params)

      setIn(sanitized, path, value)
    }

    return sanitized
  }

  async validate(data = {}, params = {}) {

    let errors = null

    for (const { path, validators } of this.properties) {

      //for each path in the schema get the equivalent value in the data
      const value = getIn(data, path)

      for (const validator of validators) {

        //run the value against every validator in this path
        const result = await validator(value, params)

        //falsy results mean validation passed
        if (!result)
          continue

        //if we've gotten here, it means a validator has failed. First we ensure
        //the errors variable is casted to an object, then we set the validator
        //results inside of it
        errors = errors || {}
        setIn(errors, path, result)
      }
    }

    return errors
  }

  properties = []

  applyHook = sanitizeAndValidate(this)

}
