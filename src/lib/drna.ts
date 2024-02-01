import _get from "lodash/get";

import {
  type ArgumentSchema,
  type ConditionSchema,
  type RootSchema,
  type PathSchema,
  type drnaParameters,
  type synthetizedDRNAMatch,
} from "../types/custom";

import Ajv from "ajv";
import Schema from "./schema";
class DRNA extends Schema {
  constructor() {
    super();
  }

  public matchDrnaFromSchema(
    drna: string[],
    schema: RootSchema
  ): object | boolean {
    if (drna.length < 2) {
      return false; // DRNA must have at least two parts: Type and the path
    }
    const type = drna[0];
    const drnaPath = drna[1].split(":");
    /* remove params and wildcard from the last path */
    if (drnaPath[drnaPath.length - 1].includes("&")) {
      drnaPath[drnaPath.length - 1] =
        drnaPath[drnaPath.length - 1].split("&")[0];
    }
    let currentSchema: RootSchema | PathSchema = schema;
    for (const part of drnaPath) {
      console.log(part in currentSchema);
      if (typeof currentSchema === "object" && part in currentSchema) {
        const nextSchema: RootSchema | PathSchema = currentSchema[part];
        if (typeof nextSchema === "object") {
          currentSchema = nextSchema;
        } else {
          console.log("nextSchema", nextSchema);
          return false;
        }
      } else {
        return false;
      }
    }
    if ((currentSchema.Type as string[]).includes(type)) {
      return currentSchema;
    } else {
      return false;
    }
  }

  private sanitizeDrnaString(drna: string): string {
    return String(drna).replace(/\./g, "-").replace(/\s/g, "-");
  }

  public matchParametersToSchema(
    injectedDrnaParams: Map<string, string>,
    schema: PathSchema,
    validatedObjects: object,
    options = {
      allowWildcards: false,
    }
  ): Record<string, string | number | undefined> {
    const parameters: Record<string, string | number | undefined> = {};
    // iterate over the schema arguments
    Object.keys(schema.Arguments).forEach((key) => {
      // if the arfument is in injectedDrnaParams
      if (injectedDrnaParams.has(key)) {
        // add the value to the parameters object
        parameters[key] = injectedDrnaParams.get(key);
        if (schema.Arguments[key].type === "number") {
          parameters[key] = Number(injectedDrnaParams.get(key));
        } else {
          if (
            schema.Arguments[key].enum === null ||
            schema.Arguments[key].enum?.includes(
              String(injectedDrnaParams.get(key))
            ) === true ||
            (options.allowWildcards &&
              String(injectedDrnaParams.get(key)) === "*")
          ) {
            parameters[key] = String(injectedDrnaParams.get(key));
          }
        }
      } else {
        // if the argument is not in injectedDrnaParams
        // add the default value to the parameters object
        const validatedObjectValue = _get(
          validatedObjects,
          schema.Arguments[key].dataFrom,
          false
        );
        if (
          validatedObjectValue &&
          (schema.Arguments[key].type === "number" ||
            (schema.Arguments[key].type === "string" &&
              schema.Arguments[key].enum === null) ||
            schema.Arguments[key].enum?.includes(
              String(validatedObjectValue)
            ) === true)
        ) {
          parameters[key] = _get(
            validatedObjects,
            schema.Arguments[key].dataFrom
          );
        }
      }
    });
    return parameters;
  }

  public mapInjectedParams(
    drnaParams: string[],
    options = {
      removeWildcards: true,
    }
  ): Map<string, string> {
    const injectedDrnaParams = new Map<string, string>(
      drnaParams
        .map((param) => {
          const [key, value] = param.split("/");
          return [key, value] as [string, string]; // Return as an entry for the Map
        })
        .filter((param) => {
          if (options.removeWildcards) {
            return param[0] !== "*";
          }
          return param;
        })
    );

    return injectedDrnaParams;
  }

  public synthetizeDrnaFromSchema(
    drna: string,
    schema: PathSchema,
    validatedObjects: object
  ): synthetizedDRNAMatch {
    // match the schema arguments with the request, user and context objects
    // return the drna with the arguments values

    const sanitizedDrna = this.sanitizeDrnaString(drna).split("&");

    const parameters = this.matchParametersToSchema(
      this.mapInjectedParams(sanitizedDrna.slice(1)),
      schema,
      validatedObjects
    );

    // join the parameters to the drna

    return {
      drnaPaths: sanitizedDrna[0].split(":"),
      parameters,
    };
  }

  public checkDrnaAccess(
    path: string[],
    parameters: drnaParameters,
    policyPath: string[],
    policyParams: drnaParameters
  ): boolean {
    const pathStr = path.join(":");
    const policyPathStr = policyPath.join(":");
    // Check if the policy path matches the input path or has a wildcard
    if (this.policyPathMatches(policyPathStr, pathStr)) {
      // Return true immediately if the policy path ends with a wildcard
      if (policyPathStr.endsWith("*")) {
        return true;
      }

      // If policy has no parameters, match only if parameters are also empty
      if (policyParams.length === 0) {
        return Object.keys(parameters).length === 0;
      }

      for (const param of Object.keys(policyParams)) {
        /*
        const splitParam = param.split("/");

        if (splitParam.length !== 2) {
          return false;
        }

        const [key, value] = splitParam;
        */
        const value = policyParams[param];
        const key = param;
        if (
          key === "*" ||
          (parameters[key] !== undefined &&
            (value === "*" || parameters[key] === value))
        ) {
          continue;
        }

        return false; // Parameter not matched or not present
      }

      return true;
    }

    return false;
  }

  private policyPathMatches(policyPath: string, inputPath: string): boolean {
    // Handle global wildcard
    if (policyPath === "*") {
      return true;
    }

    // Check for incorrect wildcard usage (like "files*")
    if (
      policyPath.endsWith("*") &&
      inputPath.charAt(policyPath.length - 1) === ":"
    ) {
      return false;
    }

    // Handle wildcard at the end of the policy path
    if (policyPath.endsWith("*")) {
      // Check that the base path (excluding the wildcard) is a prefix of the input path
      const basePolicyPath = policyPath.slice(0, -1); // Remove the wildcard

      if (inputPath.startsWith(basePolicyPath)) {
        // Ensure that the wildcard does not lead to a partial match of a path segment
        if (
          basePolicyPath.endsWith(":") ||
          inputPath.charAt(basePolicyPath.length) === ":"
        ) {
          return true;
        }
      }
      return false;
    }
    // Exact match
    return policyPath === inputPath;
  }
}
export default DRNA;