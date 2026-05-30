

# Types of (Markdown) Files

> Some people are leveraging HTML to communicate with AI coding agents; i just like markdown

## Documentation + Coding

These are files that help instruct your CODING agents to builg your api.

Coding Agents:

- Codex in your CLI on your dev machine
- Copilot in the IDE on the right-side tab

Ways these may take shape:

- Just the conversation you have (not really stored or saved anywhere, but it fits un this lump, as its comms with an agent which doesnt really go anywhere after your feature is made!)
- My "original Prompt"
    - This was made and saved as markdown for posterity only.
    - I liked the idea of writing and editing a document in a markdown so that I could build and adjust my thoughts as they came out
    This is a great place to concept out architecture as well!
        Write DB schemas and API contracts
        Include Mermaid diagrams to sequence comms between services
        DETAIL MY INTENTIONS AND GOALS
- Project/repository standards
    - What are YOUR company's standards?
    - When should a ROvs WR  db connection be used?
    - how to name functions or classes etc
    - THESE should be stored inside the project repository (already if possible) in some sort of docs folder
        - Refer to the docs from an AGENTS.md file
        - AGENTs.md is the first hook that (almost) any agent will read to learn how to code in your project.
    - ADRs and other Decisions
        - More posterity docs
        - store this inside your DOCS
        - allow dcodex the ability to read and find historical reasons and decisions

## Agents in a feature

AKA assistants, api-key enabled prompts

Really, these are the API calls out to any AI model which you are leveraging NOT for development, but for a feature.

### MODELS vs AGENTS

MODEL is something you, as a developer-user, dont have a lot of control over.

codex-5.4, gpt-5.5, claude. deepseek

These are TRAINED HEAVY FILES that oyu CAN run locally, but typically you hit a different service to process a request and run your "agent"

AGENT is something you, as a developer-user, have a TON of control over.

There are no "typical" agents.
Without any direction, any model is running an agent without an identity!

The way to inform your agent its purpose/job/task/goal is through PROMPT ENGINEERING

### Prompt Engineering

and all the other things you send into the OpenAI responses client

The thing that everybody doesn't know enough about.
This section is NOT necessarily black/white as far as "static/dynamic" input goes.
You ould adjust your system prompt dynamicallly, as much as your user prompt

ROLES

- SYSTEM PROMPT
    - typically written as hardcoded text
    - this defines the spirit/goal/etc of your AGENT
    - this is what you typically dont want hijacked by your usrs
    - DO NOT MIX user input with your system input
- USER PROMPT
    - describes more context about the request handled at the moment
    - this is a lot more dynamic than the system prompt
    - carries ephemeral data and state, while the system prompt is a larger description to what the agent's goal/purpose is
- are there other roles? im not sure!

FORMAT

Doesn't really matter!
There are a lot of options.

You can input your role prompts as human readable md/txt, json or even an XML-like structure...

```xml
<guidance>
You should research as well as you can with the internet
</guidance>
<data>
[{},{}]
</data>
```



