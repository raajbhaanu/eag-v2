"""Same agent loop as talkie.py, but the final step sends an email via Gmail MCP
instead of drawing in Paint. Connects to TWO MCP servers over stdio:
  - example2.py        (math tools)
  - gmail_mcp_server.py (send_email tool)

Before running:
  1. Set RECIPIENT_EMAIL below to where you want the result sent.
  2. Make sure credentials.json / token.json exist (see gmail_mcp_server.py header
     docstring for the one-time Google OAuth setup), and point CREDS_PATH / TOKEN_PATH
     at them.
  3. Make sure .env has GEMINI_API_KEY set.

Run:
  uv run talkie_gmail.py
"""

import os
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters, types
from mcp.client.stdio import stdio_client
import asyncio
from google import genai
from concurrent.futures import TimeoutError
from contextlib import AsyncExitStack

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

# --- Gmail config: edit these before running ---
RECIPIENT_EMAIL = "raajbhaanu@gmail.com"
CREDS_PATH = "./credentials.json"
TOKEN_PATH = "./token.json"
# ------------------------------------------------

max_iterations = 10
last_response = None
iteration = 0
iteration_response = []


async def generate_with_timeout(client, prompt, timeout=10):
    """Generate content with a timeout"""
    print("Starting LLM generation...")
    try:
        loop = asyncio.get_event_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: client.models.generate_content(
                    model="gemini-3.8-flash",
                    contents=prompt
                )
            ),
            timeout=timeout
        )
        print("LLM generation completed")
        return response
    except TimeoutError:
        print("LLM generation timed out!")
        raise
    except Exception as e:
        print(f"Error in LLM generation: {e}")
        raise


def reset_state():
    global last_response, iteration, iteration_response
    last_response = None
    iteration = 0
    iteration_response = []


def build_tools_description(tools, start_index=0):
    """Build the numbered, human-readable tool description block for a tool list."""
    lines = []
    for i, tool in enumerate(tools, start=start_index):
        try:
            params = tool.inputSchema
            desc = getattr(tool, 'description', 'No description available')
            name = getattr(tool, 'name', f'tool_{i}')

            if 'properties' in params:
                param_details = []
                for param_name, param_info in params['properties'].items():
                    param_type = param_info.get('type', 'unknown')
                    param_details.append(f"{param_name}: {param_type}")
                params_str = ', '.join(param_details)
            else:
                params_str = 'no parameters'

            tool_desc = f"{i+1}. {name}({params_str}) - {desc}"
            lines.append(tool_desc)
            print(f"Added description for tool: {tool_desc}")
        except Exception as e:
            print(f"Error processing tool {i}: {e}")
            lines.append(f"{i+1}. Error processing tool")
    return lines


async def main():
    reset_state()
    print("Starting main execution...")
    try:
        print("Establishing connections to MCP servers (math + gmail)...")
        math_server_params = StdioServerParameters(
            command="python",
            args=["example2.py"]
        )
        gmail_server_params = StdioServerParameters(
            command="python",
            args=[
                "gmail_mcp_server.py",
                "--creds-file-path", CREDS_PATH,
                "--token-path", TOKEN_PATH,
            ]
        )

        async with AsyncExitStack() as stack:
            math_read, math_write = await stack.enter_async_context(stdio_client(math_server_params))
            math_session = await stack.enter_async_context(ClientSession(math_read, math_write))
            await math_session.initialize()
            print("Math server session initialized.")

            gmail_read, gmail_write = await stack.enter_async_context(stdio_client(gmail_server_params))
            gmail_session = await stack.enter_async_context(ClientSession(gmail_read, gmail_write))
            await gmail_session.initialize()
            print("Gmail server session initialized.")

            print("Requesting tool lists from both servers...")
            math_tools = (await math_session.list_tools()).tools
            gmail_tools = (await gmail_session.list_tools()).tools
            print(f"Math server: {len(math_tools)} tools. Gmail server: {len(gmail_tools)} tools.")

            # Map tool name -> which session owns it, so calls get routed correctly
            session_for_tool = {t.name: math_session for t in math_tools}
            session_for_tool.update({t.name: gmail_session for t in gmail_tools})
            tools = math_tools + gmail_tools

            print("Creating system prompt...")
            try:
                tools_description = build_tools_description(math_tools, start_index=0)
                tools_description += build_tools_description(gmail_tools, start_index=len(math_tools))
                tools_description = "\n".join(tools_description)
                print("Successfully created tools description")
            except Exception as e:
                print(f"Error creating tools description: {e}")
                tools_description = "Error loading tools"

            print("Created system prompt...")

            system_prompt = f"""You are an agent solving problems in iterations. You have access to math tools and to a Gmail tool (send_email) for delivering the final result.

Available tools:
{tools_description}

You must respond with EXACTLY ONE line in one of these formats (no additional text):
1. For function calls:
   FUNCTION_CALL: function_name|param1|param2|...

2. For final answers:
   FINAL_ANSWER: [answer]

Important:
- When a function returns multiple values, you need to process all of them
- Do not repeat function calls with the same parameters
- After the math is done, you MUST email the result using this exact call:
  FUNCTION_CALL: send_email|{RECIPIENT_EMAIL}|Agent result|<a short sentence stating the computed answer>
- Only give FINAL_ANSWER after send_email has succeeded
- You cannot skip the email step; it is part of the task

Examples:
- FUNCTION_CALL: add|5|3
- FUNCTION_CALL: strings_to_chars_to_int|INDIA
- FUNCTION_CALL: send_email|{RECIPIENT_EMAIL}|Agent result|The sum of exponentials is 42.0
- FINAL_ANSWER: [42]

DO NOT include any explanations or additional text.
Your entire response should be a single line starting with either FUNCTION_CALL: or FINAL_ANSWER:"""

            query = """Find the ASCII values of characters in INDIA and then return sum of exponentials of those values. Then email me the final answer."""
            print("Starting iteration loop...")

            global iteration, last_response

            while iteration < max_iterations:
                print(f"\n--- Iteration {iteration + 1} ---")
                if last_response is None:
                    current_query = query
                else:
                    current_query = current_query + "\n\n" + " ".join(iteration_response)
                    current_query = current_query + "  What should I do next?"

                print("Preparing to generate LLM response...")
                prompt = f"{system_prompt}\n\nQuery: {current_query}"
                try:
                    response = await generate_with_timeout(client, prompt)
                    response_text = response.text.strip()
                    print(f"LLM Response: {response_text}")

                    for line in response_text.split('\n'):
                        line = line.strip()
                        if line.startswith("FUNCTION_CALL:"):
                            response_text = line
                            break

                except Exception as e:
                    print(f"Failed to get LLM response: {e}")
                    break

                if response_text.startswith("FUNCTION_CALL:"):
                    _, function_info = response_text.split(":", 1)
                    parts = [p.strip() for p in function_info.split("|")]
                    func_name, params = parts[0], parts[1:]

                    print(f"\nDEBUG: Raw function info: {function_info}")
                    print(f"DEBUG: Split parts: {parts}")
                    print(f"DEBUG: Function name: {func_name}")
                    print(f"DEBUG: Raw parameters: {params}")

                    try:
                        tool = next((t for t in tools if t.name == func_name), None)
                        if not tool:
                            print(f"DEBUG: Available tools: {[t.name for t in tools]}")
                            raise ValueError(f"Unknown tool: {func_name}")

                        session = session_for_tool[func_name]
                        print(f"DEBUG: Found tool: {tool.name} (routed to {'math' if session is math_session else 'gmail'} session)")
                        print(f"DEBUG: Tool schema: {tool.inputSchema}")

                        arguments = {}
                        schema_properties = tool.inputSchema.get('properties', {})
                        print(f"DEBUG: Schema properties: {schema_properties}")

                        for param_name, param_info in schema_properties.items():
                            if not params:
                                raise ValueError(f"Not enough parameters provided for {func_name}")

                            value = params.pop(0)
                            param_type = param_info.get('type', 'string')

                            print(f"DEBUG: Converting parameter {param_name} with value {value} to type {param_type}")

                            if param_type == 'integer':
                                arguments[param_name] = int(value)
                            elif param_type == 'number':
                                arguments[param_name] = float(value)
                            elif param_type == 'array':
                                if isinstance(value, str):
                                    value = value.strip('[]').split(',')
                                arguments[param_name] = [int(x.strip()) for x in value]
                            else:
                                arguments[param_name] = str(value)
                        print(f"DEBUG: Final arguments: {arguments}")
                        print(f"DEBUG: Calling tool {func_name}")

                        result = await session.call_tool(func_name, arguments=arguments)
                        print(f"DEBUG: Raw result: {result}")

                        if hasattr(result, 'content'):
                            print(f"DEBUG: Result has content attribute")
                            if isinstance(result.content, list):
                                iteration_result = [
                                    item.text if hasattr(item, 'text') else str(item)
                                    for item in result.content
                                ]
                            else:
                                iteration_result = str(result.content)
                        else:
                            print(f"DEBUG: Result has no content attribute")
                            iteration_result = str(result)

                        print(f"DEBUG: Final iteration result: {iteration_result}")

                        if isinstance(iteration_result, list):
                            result_str = f"[{', '.join(iteration_result)}]"
                        else:
                            result_str = str(iteration_result)

                        iteration_response.append(
                            f"In the {iteration + 1} iteration you called {func_name} with {arguments} parameters, "
                            f"and the function returned {result_str}."
                        )
                        last_response = iteration_result

                    except Exception as e:
                        print(f"DEBUG: Error details: {str(e)}")
                        print(f"DEBUG: Error type: {type(e)}")
                        import traceback
                        traceback.print_exc()
                        iteration_response.append(f"Error in iteration {iteration + 1}: {str(e)}")
                        break

                elif response_text.startswith("FINAL_ANSWER:"):
                    print("\n=== Agent Execution Complete ===")
                    break

                iteration += 1

    except Exception as e:
        print(f"Error in main execution: {e}")
        import traceback
        traceback.print_exc()
    finally:
        reset_state()


if __name__ == "__main__":
    asyncio.run(main())
