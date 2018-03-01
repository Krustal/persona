import {
  append,
  prepend,
  filter,
  propEq,
  keys,
  pick,
  dropLast,
  contains,
  not,
  equals,
  always,
  compose,
  join,
  merge,
  values,
  difference,
  forEach,
  concat,
  map,
  flatten,
  path,
  split,
  last,
  intersperse,
  reduce,
  cond,
  type,
  identity,
  init,
  pair,
  head,
  ifElse,
  reject,
  isNil,
  tail,
  chain,
  prop,
  isEmpty,
  complement,
  __
} from 'ramda';

export class InvalidField extends Error {
  constructor(field, ...params) {
    // Pass remaining arguments (including vendor specific ones) to parent constructor
    super(`Attempted to set undefined field "${field}"`, ...params);

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidField);
    }

    // Custom debugging information
    this.field = field;
  }
}

export class InvalidChoice extends Error {
  constructor(field, value, reason, ...params) {
    super(`Attempted to choose [${value}] for [${field}], ${reason}`);

    if (Error.captureStackTrace) Error.captureStackTrace(this, InvalidChoice);

    this.field = field;
    this.value = value;
    this.reason = reason;
  }
}

export default function (definition) {
  // choices that have custom side effects
  // TODO: should be able to factor these out eventually
  const nonLiteral = f => not(contains(f.options, values(OptionLiterals)));
  const nonLiteralDefChoices = keys(filter(nonLiteral, definition.fields));
  return class GeneratedBuilder {
    constructor(values) {
      this.choices = {};

      function set(field, value) {
        this.choices[field] = value;
      }

      const validFields = keys(definition.fields);

      Object.keys(values).forEach(field => {
        const nonLiteralChoices = nonLiteralDefChoices;
        if (not(contains(field, this.fields()))) throw new InvalidField(field);
        const choiceConfig = this._choiceConfig(field);
        const validOptions = choiceConfig.options;
        switch (typeof validOptions) {
          case 'symbol': {
            const notMatchType = compose(not, equals(__, typeof values[field]));
            switch (validOptions) {
              case OptionLiterals.STRING:
                if (notMatchType('string'))
                  {throw new InvalidChoice(
                    field,
                    values[field],
                    "must be string"
                  );}
                break;
              case OptionLiterals.NUMBER:
                if (notMatchType('number'))
                  {throw new InvalidChoice(
                    field,
                    values[field],
                    "must be number"
                  );}
                break;
            }
            break;
          }
          case 'object': {
            if (not(contains(values[field], keys(validOptions)))) {
              throw new InvalidChoice(
                field,
                values[field],
                `must be one of [${join(', ', keys(validOptions))}]`
              );
            }
          }
          default:
            break;
        }
        // if we don't have a validation rule, then it is always valid
        const validationRule = choiceConfig.validation || always(true);
        if (not(validationRule(values[field])))
          {throw new InvalidChoice(field, values[field]);}
        set.call(this, field, values[field]);
      });
    }

    static createFrom(origin, config) {
      return new this.prototype.constructor(config);
    }

    fields() {
      const ideaFn = (config, breadcrumb = []) => {
        const fields = config.fields;
        const field = join('.', breadcrumb);
        const children = keys(fields);
        const response = [
          field,
          map(key => {
            const options = fields[key].options;
            const route = append(key, breadcrumb);
            const choicePath = join('.', reject(isNil, route));
            const optionsAreLiteral = equals('Symbol', type(options));
            const hasChoice = this.choices[choicePath] === undefined;
            if (optionsAreLiteral || hasChoice) return choicePath;
            return ideaFn(options[this.choices[choicePath]], route);
          }, children),
        ];
        return flatten(response);
      };
      // remove the empty string field that is generated for the root
      return tail(ideaFn(definition));
    }

    requires() {
      return keys(filter(propEq('required', true), definition.fields));
    }

    missing() {
      const result = [];
      const undefinedChoice = field => this.choices[field] === undefined;
      const literalChoice = f => contains(f.options, values(OptionLiterals));
      const findMissingFor = chain(choicePath => {
        const choice = this.choices[choicePath];
        const choiceFields = path(['options', choice, 'fields']);
        const config = this._choiceConfig(choicePath);
        const fields = isNil(choice) ? config : choiceFields(config);
        // TODO: still bugs me that I need these branches
        const addBreadcrumb = field => ifElse(isEmpty, always(field), concat(__, `.${field}`))(choicePath);
        const fullChoicePaths = map(addBreadcrumb);
        // choices at this level that are unmade
        const missingChoices = filter(undefinedChoice, fullChoicePaths(keys(fields)));
        // made choices that need further exploration
        const nonLiteralChoices = keys(reject(literalChoice, fields));
        const madeChoices = filter(complement(undefinedChoice), fullChoicePaths(nonLiteralChoices));
        return concat(missingChoices, findMissingFor(madeChoices));
      });
      return findMissingFor(['']);
    }

    /**
     * @private
     * Given a period seperated path, returns the config for the
     * option. Each step in the path will follow that field and
     * the choice made for it so you don't have to re-specify the
     * choice.
     * @example
     * let Character = new Builder(config);
     * let ragnar = new Character({ a: 'first' });
     * ragnar.choiceConfig('a.b');
     * // => { options: { second: { foo: 'baz' } } };
     * @param {string} field - period seperated path to field
     * @returns {object} - object configuring field following field path
     */
    _choiceConfig(field) {
      const breadcrumb = split('.', field);
      const choices = reject(isNil, init(breadcrumb));
      const builtPath = append(
        last(breadcrumb),
        chain(
          option => [option, 'options', this.choices[option], 'fields'],
          choices
        )
      );
      return path(reject(isEmpty, builtPath), definition.fields);
    }

    /**
     * Given a period seperated list of options, resolves the path to provide
     * a list of valid choices that can passed to `.choose()` or a symbol for
     * literal types (e.g. string, number).
     * @param {string} field - period seperated path to field
     * @return {string[]|symbol} - list of valid option choices
     */
    options(field) {
      const options = prop('options', this._choiceConfig(field));

      return cond([
        [compose(equals('Symbol'), type), identity],
        [compose(equals('Object'), type), keys],
      ])(options);
    }

    choose(field, value) {
      return new GeneratedBuilder.prototype.constructor(merge(this.choices, { [field]: value }));
    }

    get(field) {
      return this.choices[field];
    }
  };
}

const STRING = Symbol('STRING');
const NUMBER = Symbol('NUMBER');
export const OptionLiterals = {
  STRING,
  NUMBER,
};
