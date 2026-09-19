# MCP Contexts.

## General
1. we have local mcp app that shipped to user.
2. mcp used for if user need connect their account and colaborating with their ai agent to access / analize data in our system.


## General Flow Of MCP
```mermaid
stateDiagram-v2
    direction LR

    state "User" as user
    state "Local MCP" as mcp
    state "AI Agent" as agent

    sys: Warehouse System
    state sys {
        state "rpc api services" as rpc
    }

    

    user-->agent
    agent-->user: Colaborating with AI Agent
    mcp-->agent: used by agent

    mcp-->rpc
```