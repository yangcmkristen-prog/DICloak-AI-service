import assert from "node:assert/strict";
import test from "node:test";
import { selectApiEndpointsByProductAndKeywords, selectApiParameters } from "./api-parameters";

test("returns all selected-product endpoints sharing a keyword hit", () => {
  const endpoints = [
    { apiId: "DIC-ENV-LIST", supportedProduct: "dicloak" as const, searchKeywords: "查询环境,环境列表" },
    { apiId: "DIC-ENV-DETAIL", supportedProduct: "all" as const, searchKeywords: "查询环境,环境详情" },
    { apiId: "PARA-ENV-LIST", supportedProduct: "paraturbo" as const, searchKeywords: "查询环境,环境列表" },
  ];

  assert.deepEqual(
    selectApiEndpointsByProductAndKeywords(endpoints, [], "dicloak", "如何查询环境？"),
    [endpoints[0], endpoints[1]],
  );
});

test("falls back to compatible direct matches when no search keyword is hit", () => {
  const endpoints = [
    { apiId: "DIC", supportedProduct: "dicloak" as const },
    { apiId: "PARA", supportedProduct: "paraturbo" as const },
  ];
  assert.deepEqual(selectApiEndpointsByProductAndKeywords(endpoints, endpoints, "dicloak", "API"), [endpoints[0]]);
});

test("returns all parameters for matched api_ids plus every empty-api_id row", () => {
  const parameters = [
    { apiId: "API-A", paramName: "a" },
    { apiId: "API-B", paramName: "b" },
    { apiId: "", paramName: "shared-empty" },
    { paramName: "shared-missing" },
    { apiId: "  ", paramName: "shared-whitespace" },
  ];
  assert.deepEqual(selectApiParameters(parameters, ["API-A"]), [parameters[0], parameters[2], parameters[3], parameters[4]]);
});