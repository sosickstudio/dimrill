const Conditions = require("./list");
/**
 *
 * @param {object} req - The req object passed from the server.
 * @param {object} user - The data associated to the user attempting to authorize.
 * @param {object} context - An object containing additional informations to be used during the authorization process.
 * @param {string} condition - A string containing to condition from which to extract operators.
 * @returns {object} - An object with keys: ToContext (Boolean), AnyValue (Boolean), EveryValue (Boolean), condition (String).
 */
const getOperators = (req, user, context, condition) => {
  const instructions = {
    ToContext: false,
    AnyValue: false,
    EveryValue: false,
    condition: "",
  };

  condition.split(":").forEach((e) => {
    if (
      typeof Conditions[String(e)] === "function" &&
      Conditions.hasOwnProperty(e)
    ) {
      /*
        Assign operator to instructions.condition
      */
      instructions.condition = e;
    } else if (
      instructions[String(e)] !== undefined &&
      typeof String(e) !== "function" &&
      instructions.hasOwnProperty(e)
    ) {
      instructions[String(e)] =
        instructions[String(e)] !== undefined ? true : false;
    }
  });
  return instructions;
};
/**
 * @param {array} operands - Array of string from which to extract operands, written in syntax: "${variable:property.subproperty}".
 * @param {object} variables - Object containing req,user,context variables, from which the operands value will be matched.
 * @returns {*} - The value matched on variable
 */
const matchVariables = (operands, variables) => {
  if (!Array.isArray(operands) || operands.length < 1) {
    return null;
  }
  return operands.map((value) => {
    if (typeof value === "string") {
      const match = value.match(/\$\{(..*?)\}/);
      if (match) {
        const variable =
          variables[match[1].split(":")[0]][match[1].split(":")[0]];
        const value = match[1]
          .split(":")[1]
          .split(".")
          .reduce((a, b) => {
            if (a && a.hasOwnProperty(b)) {
              // eslint-disable-next-line security/detect-object-injection
              return a[b];
            }
          }, variable);
        /*
            Prevents object injection by removing any function, passed as an argument 
        */
        return (typeof value !== "function" ? value : null) ?? null;
      } else {
        //value is a fixed string
        return value;
      }
    } else {
      //value is a not a string
      /*
        If a function is returned here it should get cast to supported format by either the validator or the adapter
        However if the user supplies an adapter that does not cast input type, it can lead to a code injection via adapter
      */
      return value;
    }
  });
};
/**
 *
 * @param {object} instructions - Object, @see {getOperators}
 * @param {object} conditionOperands - Object, @see {matchVariables}
 * @param {object} adapters - An object containings the functions for each operators to convert condition to DB query language, as well as a returnAs key to describe the type of data returend by {conditionsResults}.
 * @param {boolean} silent - If set to true errors will not be thrown.
 * @returns {boolean/string/object} - If instruction.toContext is true, will return an Object or a String according to returnAs specified in the adapter. Else, will return a boolean.
 */
const verifyCondition = (
  instructions,
  conditionOperands,
  adapters = {},
  silent = false
) => {
  /*
    Prevent Object property injections via condition statments
  */
  if (!Conditions[instructions.condition]) {
    if (silent) {
      return false;
    }
    console.log(instructions.condition);
    throw new Error(`Condition override detected`);
  }
  if (!conditionOperands) {
    return false;
  }
  if (
    instructions.ToContext &&
    adapters.hasOwnProperty(instructions.condition)
  ) {
    /*
        Apply adapter
      */
    try {
      return typeof adapters[instructions.condition] === "function"
        ? adapters[instructions.condition](
            conditionOperands[0],
            conditionOperands[1]
          )
        : false;
    } catch (error) {
      /*
        If adapter operator fails throws an error unless silent parameter is passed in the options in which case it returns false
      */
      if (silent) {
        return false;
      }
      throw new Error(`Invalid adapter operator: ${error}`);
    }
  } else {
    /*
        validate condition
      */

    try {
      return typeof Conditions[instructions.condition] === "function"
        ? Conditions[instructions.condition](
            conditionOperands[0],
            conditionOperands[1]
          )
        : false;
    } catch (error) {
      /*
        If operator fails throws an error unless silent parameter is passed in the options in which case it returns false
      */
      if (silent) {
        return false;
      }
      throw new Error(`Invalid operator: ${error}`);
    }
  }
};
/**
 *
 * @param {object} instructions - Object, @see {getOperators}
 * @param {object} conditionOperands - Object, @see {matchVariables}
 * @param {object} req - The req object passed from the server.
 * @param {object} user - The data associated to the user attempting to authorize.
 * @param {object} context - An object containing additional informations to be used during the authorization process.
 * @param {object} adapters - An object containings the functions for each operators to convert condition to DB query language, as well as a returnAs key to describe the type of data returend by {conditionsResults}.
 * @param {boolean} silent - If set to true errors will not throw an exception.
 * @returns {object} - Object with keys: valid (Boolean), hasQuery (Boolean), query (Object/String).
 */
const verifyOperator = (
  instructions,
  conditionOperands,
  req = {},
  user = {},
  context = {},
  adapters = {},
  silent = false
) => {
  const verificationState = {
    hasQuery: false,
    /*
      If adapter returAs String use an array so we can apply the logical operator to the string
    */
    query: adapters.returnAs === "Object" ? {} : [],
    valid: undefined,
  };
  //check wether conditionOperands is an array:
  conditionOperands =
    Array.isArray(conditionOperands) && conditionOperands.length > 1
      ? conditionOperands
      : Object.entries(conditionOperands).length > 1
      ? Object.entries(conditionOperands).map((m) => ({ [m[0]]: m[1] }))
      : Array(conditionOperands);

  conditionOperands.forEach((operand, k, arr) => {
    const OperandsArray = matchVariables(
      Object.entries(operand)[0],
      {
        req,
        user,
        context,
      },
      false
    );
    let validated = verifyCondition(
      instructions,
      OperandsArray,
      adapters,
      instructions.ToContext,
      silent
    );
    if (typeof validated === "boolean") {
      /*
            Verify wether condition matches instructions
        */
      verificationState.valid =
        (validated || verificationState.valid === true) &&
        instructions.AnyValue &&
        instructions.condition
          ? true
          : validated &&
            (verificationState.valid === true ||
              verificationState.valid === undefined);
    } else if (
      (typeof validated === "object" &&
        !Array.isArray(validated) &&
        validated !== null &&
        Object.keys(validated).length >= 1) ||
      typeof validated === "string"
    ) {
      /*
          Add context
          Mark as Valid
      */
      if (adapters.returnAs === "Object" && typeof validated == "object") {
        verificationState.valid =
          Object.is(arr.length - 1, k) && verificationState.valid === undefined
            ? true
            : verificationState.valid;
        verificationState.query = {
          ...verificationState.query,
          ...validated,
        };
        verificationState.hasQuery = true;
      } else if (
        adapters.returnAs === "String" &&
        typeof validated == "string"
      ) {
        verificationState.query.push(validated);
        verificationState.hasQuery = true;
        verificationState.valid =
          verificationState.query.length >= 1 ? true : verificationState.valid;
      }
    }
  });
  /* 
        check wether Context must be wrapped in a logic operator
  */
  /*
    Check for returnAs Object
  */
  if (
    adapters.returnAs === "Object" &&
    verificationState.hasQuery &&
    Object.keys(verificationState.query).length >= 2
  ) {
    /* 
        Context must be applied to a OR logical operator
      */
    if (instructions.AnyValue) {
      verificationState.query = adapters.operators.or(verificationState.query);
    } else {
      /* 
        Context must be applied to a AND logical operator,
        this line is required to make sure translation to languages other than MongoDB happens
      */
      verificationState.query = adapters.operators.and(verificationState.query);
    }
  } else if (
    /*
    Check for returnAs String
  */
    adapters.returnAs === "String" &&
    verificationState.hasQuery &&
    verificationState.query.length >= 1
  ) {
    if (instructions.AnyValue) {
      verificationState.query = adapters.operators.or(verificationState.query);
    } else {
      verificationState.query = adapters.operators.and(verificationState.query);
    }
  }
  return verificationState;
};
module.exports = {
  getOperators,
  verifyOperator,
};
