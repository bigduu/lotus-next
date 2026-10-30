import { expect, it } from "vitest"
import { createStore } from "zustand/vanilla"
import { createTokenBudgetSlice, tokenBudgetRevision, type TokenBudgetSlice } from "./tokenBudgetSlice"

it("tracks live token changes separately from applying a durable snapshot", () => {
  const store=createStore<TokenBudgetSlice>()(createTokenBudgetSlice), id="synthetic"
  const usage={systemTokens:1,summaryTokens:0,windowTokens:4,totalTokens:5,budgetLimit:100}
  store.getState().updateTokenUsage(id,usage,{fromSnapshot:true})
  store.getState().setTruncationInfo(id,false,0,{fromSnapshot:true})
  store.getState().clearTokenUsageValue(id,{fromSnapshot:true})
  store.getState().clearTruncationInfo(id,{fromSnapshot:true})
  expect(tokenBudgetRevision(store.getState,id)).toEqual({usage:0,truncation:0})
  store.getState().updateTokenUsage(id,usage);store.getState().setTruncationInfo(id,true,3)
  expect(tokenBudgetRevision(store.getState,id)).toEqual({usage:1,truncation:1})
})
