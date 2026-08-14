import assert from "node:assert/strict";
import test from "node:test";
import { selectApiParameters } from "./api-parameters";

test("includes unscoped parameters with every matched endpoint", () => {
  const parameters = [
    { apiId: "API-ENV-UPDATE", paramName: "name" },
    { apiId: "API-TAG-UPDATE", paramName: "tag_id" },
    { apiId: "", paramName: "proxy_binding" },
    { paramName: "proxy_type" },
  ];
  assert.deepEqual(
    selectApiParameters(parameters, ["API-TAG-UPDATE"]).map(({ paramName }) => paramName),
    ["tag_id", "proxy_binding", "proxy_type"],
  );
});

test("excludes parameters belonging to a different endpoint", () => {
  const parameters = [{ apiId: "API-A", paramName: "a" }, { apiId: "API-B", paramName: "b" }];
  assert.deepEqual(selectApiParameters(parameters, ["API-A"]), [parameters[0]]);
});