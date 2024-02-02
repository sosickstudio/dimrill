import { type ConditionSchema, type StatementCondition } from "../types/custom";
import {
  SchemaGlobalKeys,
  SchemaConditionKeys,
  SchemaOperators,
  SchemaConditionValues,
  SchemaOperands,
  SchemaCastTypes,
} from "../constants";
import ivm from "isolated-vm";
import * as operators from "./operators/operators";
import Policies from "./policies";
class Condition {
  constructor(
    options = {
      adapter: "mongodb",
    }
  ) {
    this.options = options;
  }

  private isolatedVmContext: any;
  private isolatedVm: any;
  private readonly options: {
    adapter: string;
  };

  public setVm(isolate: any, context: any): void {
    this.isolatedVmContext = context;
    this.isolatedVm = isolate;
  }

  public unsetVm(): void {
    this.isolatedVmContext = null;
    this.isolatedVm = null;
  }

  public async runConditions(
    condition: StatementCondition | undefined,
    schema: ConditionSchema
  ): Promise<{
    valid: boolean;
    query: object | string;
  }> {
    if (!condition) return { valid: true, query: {} };
    if (schema.Enforce !== undefined) {
      condition = { ...condition, ...schema.Enforce };
    }
    const results = await Promise.all(
      Object.entries(condition).map(async ([key, value]) => {
        const keys = key.split(":");
        const modifiers = keys.filter(
          (k) =>
            SchemaOperators.includes(k) ||
            SchemaOperands.includes(k) ||
            SchemaCastTypes.includes(k) ||
            k === "ToQuery"
        );

        // Identify main operator, operand, ToQuery modifier, and castType
        const mainOperator = modifiers.find((modifier) =>
          SchemaOperators.includes(modifier)
        );
        const operand = modifiers.find((modifier) =>
          SchemaOperands.includes(modifier)
        );
        const toQuery = modifiers.includes("ToQuery") ? "ToQuery" : undefined;
        const castType = modifiers.find((modifier) =>
          SchemaCastTypes.includes(modifier)
        );

        if (!mainOperator) {
          throw new Error(
            `Invalid condition key: ${key}. Main operator is missing.`
          );
        }

        const mainOperatorCount = modifiers.filter((modifier) =>
          SchemaOperators.includes(modifier)
        ).length;
        const operandCount = modifiers.filter((modifier) =>
          SchemaOperands.includes(modifier)
        ).length;
        const castTypeCount = modifiers.filter((modifier) =>
          SchemaCastTypes.includes(modifier)
        ).length;

        if (
          mainOperatorCount > 1 ||
          operandCount > 1 ||
          castTypeCount > 1 ||
          keys.length > modifiers.length
        ) {
          throw new Error(
            `Invalid condition key: ${key}. Structure not valid.`
          );
        }

        // Assuming processCondition is defined to handle the new structure
        return await this.processCondition(
          mainOperator,
          { operand, toQuery, castType },
          value
        );
      })
    );

    return this.mergeConditionsResults(results);
  }

  private mergeConditionsResults(
    results: Array<{
      valid: boolean;
      query: object | string;
    }>
  ): {
    valid: boolean;
    query: object | string;
  } {
    // Determine if all are valid
    const isValid = results.every((result) => result.valid);

    // Determine the type of query in the results
    const allQueries = results.map((result) => result.query);
    const isObjectQuery = typeof allQueries[0] === "object";

    // Merge queries based on their type
    const mergedQuery = isObjectQuery
      ? this.mergeObjectQueries(allQueries as Array<Record<string, any>>)
      : this.mergeStringQueries(allQueries as string[]);

    return {
      valid: isValid,
      query: mergedQuery,
    };
  }

  private mergeObjectQueries(
    queries: Array<Record<string, any>>
  ): Record<string, any> {
    const mergedQuery: Record<string, any> = {};
    for (const query of queries) {
      for (const key in query) {
        if (mergedQuery.hasOwnProperty(key)) {
          // If the key already exists, combine the values. Here, we're simply overwriting,
          // but you might want to merge or concatenate, depending on your needs.
          mergedQuery[key] = [...new Set([...mergedQuery[key], ...query[key]])];
        } else {
          mergedQuery[key] = query[key];
        }
      }
    }
    return mergedQuery;
  }

  private mergeStringQueries(queries: string[]) {
    return queries.join("; "); // Using '; ' as a delimiter
  }

  private async processCondition(
    mainOperator: string,
    modifiers: {
      operand: string | undefined;
      toQuery: string | undefined;
      castType: string | undefined;
    },
    values: object
  ): Promise<{
    valid: boolean;
    query: object | string;
  }> {
    const returnValue = {
      valid: false,
      query: {},
    };

    if (modifiers.toQuery) {
      returnValue.valid = true;
      const results = await Promise.all(
        Object.entries(values).map(async (variables) => {
          return await this.runAdapter(mainOperator, variables);
        })
      );
      console.log("Results", results);
    } else {
      const results = await Promise.all(
        Object.entries(values).map(async (variables) => {
          return await this.runCondition(mainOperator, variables);
        })
      );

      // Process results
      if (modifiers.operand === "AnyValues") {
        returnValue.valid = results.filter((result) => result).length > 0;
      }

      returnValue.valid =
        results.filter((result) => result).length === results.length;
    }
    return returnValue;
  }

  private async runAdapter(
    operator: string,
    valueArray: string[]
  ): Promise<Record<string, object> | string> {
    const result = await this.isolatedVmContext.eval(`
    (function() {
      const formattedValue1 = formatValue(${JSON.stringify(
        valueArray[0]
      )}, groupedContext);
      const formattedValue2 = formatValue(${JSON.stringify(
        valueArray[1]
      )}, groupedContext);
    
    
      const query = __adapterClass__.apply(
        undefined, 
        ["${operator}", formattedValue1, formattedValue2],
        {
          arguments: { copy: true },
        }
        );
      return JSON.stringify(query);
    })()
    `);

    return JSON.parse(result as string);
  }

  private async runCondition(
    operator: string,
    valueArray: string[]
  ): Promise<boolean> {
    const result = await this.isolatedVmContext.eval(`
    (function() {
    const formattedValue1 = formatValue(${JSON.stringify(
      valueArray[0]
    )}, groupedContext);
    const formattedValue2 = formatValue(${JSON.stringify(
      valueArray[1]
    )}, groupedContext);
    
    
    return  (__operatorsClass__.apply(
      undefined, 
      ["${operator}", formattedValue1, formattedValue2],
      {
        arguments: { copy: true },
       
      }
    ));
    })()
    `);
    console.log("VM condition says", result);
    return result;
  }
}
export default Condition;
