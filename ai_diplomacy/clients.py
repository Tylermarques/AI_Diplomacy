import os
import json
import re
import ast  # For literal_eval in JSON fallback parsing
import aiohttp  # For direct HTTP requests to Responses API

from typing import List, Dict, Optional, Any, Tuple
from dotenv import load_dotenv
from loguru import logger

# Use Async versions of clients
from openai import AsyncOpenAI
from openai import AsyncOpenAI as AsyncDeepSeekOpenAI  # Alias for clarity
from anthropic import AsyncAnthropic

import google.generativeai as genai

from diplomacy.engine.message import GLOBAL
from .game_history import GameHistory
from .utils import (
    load_prompt,
    run_llm_and_log,
    log_llm_response,
)  # Ensure log_llm_response is imported

# Import DiplomacyAgent for type hinting if needed, but avoid circular import if possible
# from .agent import DiplomacyAgent
from .possible_order_context import generate_rich_order_context
from .prompt_constructor import (
    construct_order_generation_prompt,
    build_context_prompt,
)  # Ensure build_context_prompt is imported


load_dotenv()


##############################################################################
# 1) Base Interface
##############################################################################
class BaseModelClient:
    """
    Base interface for any LLM client we want to plug in.
    Each must provide:
      - generate_response(prompt: str) -> str
      - get_orders(board_state, power_name, possible_orders) -> List[str]
      - get_conversation_reply(power_name, conversation_so_far, game_phase) -> str
    """

    def __init__(self, model_name: str):
        self.model_name = model_name
        # Load a default initially, can be overwritten by set_system_prompt
        self.system_prompt = load_prompt("system_prompt.txt")

    def set_system_prompt(self, content: str):
        """Allows updating the system prompt after initialization."""
        self.system_prompt = content
        logger.info(f"[{self.model_name}] System prompt updated.")

    async def generate_response(self, prompt: str) -> str:
        """
        Returns a raw string from the LLM.
        Subclasses override this.
        """
        raise NotImplementedError("Subclasses must implement generate_response().")

    # build_context_prompt and build_prompt (now construct_order_generation_prompt)
    # have been moved to prompt_constructor.py

    async def get_orders(
        self,
        game,
        board_state,
        power_name: str,
        possible_orders: Dict[str, List[str]],
        conversation_text: str,  # This is GameHistory
        model_error_stats: dict,
        log_file_path: str,
        phase: str,
        agent_goals: Optional[List[str]] = None,
        agent_relationships: Optional[Dict[str, str]] = None,
        agent_private_diary_str: Optional[str] = None,  # Added
    ) -> List[str]:
        """
        1) Builds the prompt with conversation context if available
        2) Calls LLM
        3) Parses JSON block
        """
        # The 'conversation_text' parameter was GameHistory. Renaming for clarity.
        game_history_obj = conversation_text

        prompt = construct_order_generation_prompt(
            system_prompt=self.system_prompt,
            game=game,
            board_state=board_state,
            power_name=power_name,
            possible_orders=possible_orders,
            game_history=game_history_obj,  # Pass GameHistory object
            agent_goals=agent_goals,
            agent_relationships=agent_relationships,
            agent_private_diary_str=agent_private_diary_str,
        )

        raw_response = ""
        # Initialize success status. Will be updated based on outcome.
        success_status = "Failure: Initialized"
        parsed_orders_for_return = self.fallback_orders(
            possible_orders
        )  # Default to fallback

        try:
            # Call LLM using the logging wrapper
            raw_response = await run_llm_and_log(
                client=self,
                prompt=prompt,
                log_file_path=log_file_path,
                power_name=power_name,
                phase=phase,
                response_type="order",  # Context for run_llm_and_log's own error logging
            )
            logger.debug(
                f"[{self.model_name}] Raw LLM response for {power_name} orders:\n{raw_response}"
            )

            # Attempt to parse the final "orders" from the LLM
            move_list = self._extract_moves(raw_response, power_name)

            if not move_list:
                logger.warning(
                    f"[{self.model_name}] Could not extract moves for {power_name}. Using fallback."
                )
                if (
                    model_error_stats is not None
                    and self.model_name in model_error_stats
                ):
                    model_error_stats[self.model_name].setdefault(
                        "order_decoding_errors", 0
                    )
                    model_error_stats[self.model_name]["order_decoding_errors"] += 1
                success_status = "Failure: No moves extracted"
                # Fallback is already set to parsed_orders_for_return
            else:
                # Validate or fallback
                validated_moves, invalid_moves_list = self._validate_orders(
                    move_list, possible_orders
                )
                logger.debug(
                    f"[{self.model_name}] Validated moves for {power_name}: {validated_moves}"
                )
                parsed_orders_for_return = validated_moves
                if invalid_moves_list:
                    # Truncate if too many invalid moves to keep log readable
                    max_invalid_to_log = 5
                    display_invalid_moves = invalid_moves_list[:max_invalid_to_log]
                    omitted_count = len(invalid_moves_list) - len(display_invalid_moves)

                    invalid_moves_str = ", ".join(display_invalid_moves)
                    if omitted_count > 0:
                        invalid_moves_str += f", ... ({omitted_count} more)"

                    success_status = f"Failure: Invalid LLM Moves ({len(invalid_moves_list)}): {invalid_moves_str}"
                    # If some moves were validated despite others being invalid, it's still not a full 'Success'
                    # because the LLM didn't provide a fully usable set of orders without intervention/fallbacks.
                    # The fallback_orders logic within _validate_orders might fill in missing pieces,
                    # but the key is that the LLM *proposed* invalid moves.
                    if not validated_moves:  # All LLM moves were invalid
                        logger.warning(
                            f"[{power_name}] All LLM-proposed moves were invalid. Using fallbacks. Invalid: {invalid_moves_list}"
                        )
                    else:
                        logger.info(
                            f"[{power_name}] Some LLM-proposed moves were invalid. Using fallbacks/validated. Invalid: {invalid_moves_list}"
                        )
                else:
                    success_status = "Success"

        except Exception as e:
            logger.error(
                f"[{self.model_name}] LLM error for {power_name} in get_orders: {e}",
                exc_info=True,
            )
            success_status = f"Failure: Exception ({type(e).__name__})"
            # Fallback is already set to parsed_orders_for_return
        finally:
            # Log the attempt regardless of outcome
            if log_file_path:  # Only log if a path is provided
                log_llm_response(
                    log_file_path=log_file_path,
                    model_name=self.model_name,
                    power_name=power_name,
                    phase=phase,
                    response_type="order_generation",  # Specific type for CSV logging
                    raw_input_prompt=prompt,  # Renamed from 'prompt' to match log_llm_response arg
                    raw_response=raw_response,
                    success=success_status,
                    # token_usage and cost can be added later if available and if log_llm_response supports them
                )
        return parsed_orders_for_return

    def _extract_moves(self, raw_response: str, power_name: str) -> Optional[List[str]]:
        """
        Attempt multiple parse strategies to find JSON array of moves.

        1. Regex for PARSABLE OUTPUT lines.
        2. If that fails, also look for fenced code blocks with { ... }.
        3. Attempt bracket-based fallback if needed.

        Returns a list of move strings or None if everything fails.
        """
        # 1) Regex for "PARSABLE OUTPUT:{...}"
        pattern = r"PARSABLE OUTPUT:\s*(\{[\s\S]*\})"
        matches = re.search(pattern, raw_response, re.DOTALL)

        if not matches:
            # Some LLMs might not put the colon or might have triple backtick fences.
            logger.debug(
                f"[{self.model_name}] Regex parse #1 failed for {power_name}. Trying alternative patterns."
            )

            # 1b) Check for inline JSON after "PARSABLE OUTPUT"
            pattern_alt = r"PARSABLE OUTPUT\s*\{(.*?)\}\s*$"
            matches = re.search(pattern_alt, raw_response, re.DOTALL)

        if not matches:
            # 1c) Check for **PARSABLE OUTPUT:** pattern (with asterisks)
            logger.debug(
                f"[{self.model_name}] Regex parse #2 failed for {power_name}. Trying asterisk-wrapped pattern."
            )
            pattern_asterisk = r"\*\*PARSABLE OUTPUT:\*\*\s*(\{[\s\S]*?\})"
            matches = re.search(pattern_asterisk, raw_response, re.DOTALL)

        if not matches:
            logger.debug(
                f"[{self.model_name}] Regex parse #3 failed for {power_name}. Trying triple-backtick code fences."
            )

        # 2) If still no match, check for triple-backtick code fences containing JSON
        if not matches:
            code_fence_pattern = r"```json\n(.*?)\n```"
            matches = re.search(code_fence_pattern, raw_response, re.DOTALL)
            if matches:
                logger.debug(
                    f"[{self.model_name}] Found triple-backtick JSON block for {power_name}."
                )

        # 2b) Also try plain ``` code fences without json marker
        if not matches:
            code_fence_plain = r"```\n(.*?)\n```"
            matches = re.search(code_fence_plain, raw_response, re.DOTALL)
            if matches:
                logger.debug(
                    f"[{self.model_name}] Found plain triple-backtick block for {power_name}."
                )

        # 2c) Try to find bare JSON object anywhere in the response
        if not matches:
            logger.debug(
                f"[{self.model_name}] No explicit markers found for {power_name}. Looking for bare JSON."
            )
            # Look for a JSON object that contains "orders" key
            bare_json_pattern = r'(\{[^{}]*"orders"\s*:\s*\[[^\]]*\][^{}]*\})'
            matches = re.search(bare_json_pattern, raw_response, re.DOTALL)
            if matches:
                logger.debug(
                    f"[{self.model_name}] Found bare JSON object with 'orders' key for {power_name}."
                )

        # 3) Attempt to parse JSON if we found anything
        json_text = None
        if matches:
            # Add braces back around the captured group if needed
            captured = matches.group(1).strip()
            if captured.startswith(r"{{"):
                json_text = captured[1:-1]
            elif captured.startswith(r"{"):
                json_text = captured
            else:
                json_text = "{%s}" % captured

            json_text = json_text.strip()

        if not json_text:
            logger.debug(
                f"[{self.model_name}] No JSON text found in LLM response for {power_name}."
            )
            return None

        # 3a) Try JSON loading
        try:
            data = json.loads(json_text)
            return data.get("orders", None)
        except json.JSONDecodeError as e:
            logger.warning(
                f"[{self.model_name}] JSON decode failed for {power_name}: {e}. Trying to fix common issues."
            )

            # Try to fix common JSON issues
            try:
                # Remove trailing commas
                fixed_json = re.sub(r",\s*([\}\]])", r"\1", json_text)
                # Fix single quotes to double quotes
                fixed_json = fixed_json.replace("'", '"')
                # Try parsing again
                data = json.loads(fixed_json)
                logger.info(
                    f"[{self.model_name}] Successfully parsed JSON after fixes for {power_name}"
                )
                return data.get("orders", None)
            except json.JSONDecodeError:
                logger.warning(
                    f"[{self.model_name}] JSON decode still failed after fixes for {power_name}. Trying to remove inline comments."
                )

                # Try to remove inline comments (// style)
                try:
                    # Remove // comments from each line
                    lines = json_text.split("\n")
                    cleaned_lines = []
                    for line in lines:
                        # Find // that's not inside quotes
                        comment_pos = -1
                        in_quotes = False
                        escape_next = False
                        for i, char in enumerate(line):
                            if escape_next:
                                escape_next = False
                                continue
                            if char == "\\":
                                escape_next = True
                                continue
                            if char == '"' and not escape_next:
                                in_quotes = not in_quotes
                            if not in_quotes and line[i : i + 2] == "//":
                                comment_pos = i
                                break

                        if comment_pos >= 0:
                            # Remove comment but keep any trailing comma
                            cleaned_line = line[:comment_pos].rstrip()
                        else:
                            cleaned_line = line
                        cleaned_lines.append(cleaned_line)

                    comment_free_json = "\n".join(cleaned_lines)
                    # Also remove trailing commas after comment removal
                    comment_free_json = re.sub(
                        r",\s*([\}\]])", r"\1", comment_free_json
                    )

                    data = json.loads(comment_free_json)
                    logger.info(
                        f"[{self.model_name}] Successfully parsed JSON after removing inline comments for {power_name}"
                    )
                    return data.get("orders", None)
                except json.JSONDecodeError:
                    logger.warning(
                        f"[{self.model_name}] JSON decode still failed after removing comments for {power_name}. Trying bracket fallback."
                    )

        # 3b) Attempt bracket fallback: we look for the substring after "orders"
        #     E.g. "orders: ['A BUD H']" and parse it. This is risky but can help with minor JSON format errors.
        #     We only do this if we see something like "orders": ...
        bracket_pattern = r'["\']orders["\']\s*:\s*\[([^\]]*)\]'
        bracket_match = re.search(bracket_pattern, json_text, re.DOTALL)
        if bracket_match:
            try:
                raw_list_str = "[" + bracket_match.group(1).strip() + "]"
                moves = ast.literal_eval(raw_list_str)
                if isinstance(moves, list):
                    return moves
            except Exception as e2:
                logger.warning(
                    f"[{self.model_name}] Bracket fallback parse also failed for {power_name}: {e2}"
                )

        # If all attempts failed
        return None

    def _validate_orders(
        self, moves: List[str], possible_orders: Dict[str, List[str]]
    ) -> Tuple[List[str], List[str]]:  # MODIFIED RETURN TYPE
        """
        Filter out invalid moves, fill missing with HOLD, else fallback.
        Returns a tuple: (validated_moves, invalid_moves_found)
        """
        logger.debug(f"[{self.model_name}] Proposed LLM moves: {moves}")
        validated = []
        invalid_moves_found = []  # ADDED: To collect invalid moves
        used_locs = set()

        if not isinstance(moves, list):
            logger.debug(f"[{self.model_name}] Moves not a list, fallback.")
            # Return fallback and empty list for invalid_moves_found as no specific LLM moves were processed
            return self.fallback_orders(possible_orders), []

        for move_str in moves:
            # Check if it's in possible orders
            if any(move_str in loc_orders for loc_orders in possible_orders.values()):
                validated.append(move_str)
                parts = move_str.split()
                if len(parts) >= 2:
                    used_locs.add(parts[1][:3])
            else:
                logger.debug(f"[{self.model_name}] Invalid move from LLM: {move_str}")
                invalid_moves_found.append(move_str)  # ADDED: Collect invalid move

        # Fill missing with hold
        for loc, orders_list in possible_orders.items():
            if loc not in used_locs and orders_list:
                hold_candidates = [o for o in orders_list if o.endswith("H")]
                validated.append(
                    hold_candidates[0] if hold_candidates else orders_list[0]
                )

        if (
            not validated and not invalid_moves_found
        ):  # Only if LLM provided no valid moves and no invalid moves (e.g. empty list from LLM)
            logger.warning(
                f"[{self.model_name}] No valid LLM moves provided and no invalid ones to report. Using fallback."
            )
            return self.fallback_orders(possible_orders), []
        elif not validated and invalid_moves_found:  # All LLM moves were invalid
            logger.warning(
                f"[{self.model_name}] All LLM moves invalid ({len(invalid_moves_found)} found), using fallback. Invalid: {invalid_moves_found}"
            )
            # We return empty list for validated, but the invalid_moves_found list is populated
            return self.fallback_orders(possible_orders), invalid_moves_found

        # If we have some validated moves, return them along with any invalid ones found
        return validated, invalid_moves_found

    def fallback_orders(self, possible_orders: Dict[str, List[str]]) -> List[str]:
        """
        Just picks HOLD if possible, else first option.
        """
        fallback = []
        for loc, orders_list in possible_orders.items():
            if orders_list:
                holds = [o for o in orders_list if o.endswith("H")]
                fallback.append(holds[0] if holds else orders_list[0])
        return fallback

    def build_planning_prompt(
        self,
        game,
        board_state,
        power_name: str,
        possible_orders: Dict[str, List[str]],
        game_history: GameHistory,
        # game_phase: str, # Not used directly by build_context_prompt
        # log_file_path: str, # Not used directly by build_context_prompt
        agent_goals: Optional[List[str]] = None,
        agent_relationships: Optional[Dict[str, str]] = None,
        agent_private_diary_str: Optional[str] = None,  # Added
    ) -> str:
        instructions = load_prompt("planning_instructions.txt")

        context = self.build_context_prompt(
            game,
            board_state,
            power_name,
            possible_orders,
            game_history,
            agent_goals=agent_goals,
            agent_relationships=agent_relationships,
            agent_private_diary=agent_private_diary_str,  # Pass diary string
        )

        return context + "\n\n" + instructions

    def build_conversation_prompt(
        self,
        game,
        board_state,
        power_name: str,
        possible_orders: Dict[str, List[str]],
        game_history: GameHistory,
        # game_phase: str, # Not used directly by build_context_prompt
        # log_file_path: str, # Not used directly by build_context_prompt
        agent_goals: Optional[List[str]] = None,
        agent_relationships: Optional[Dict[str, str]] = None,
        agent_private_diary_str: Optional[str] = None,  # Added
    ) -> str:
        instructions = load_prompt("conversation_instructions.txt")

        context = build_context_prompt(
            game,
            board_state,
            power_name,
            possible_orders,
            game_history,
            agent_goals=agent_goals,
            agent_relationships=agent_relationships,
            agent_private_diary=agent_private_diary_str,  # Pass diary string
        )

        # Get recent messages targeting this power to prioritize responses
        recent_messages_to_power = game_history.get_recent_messages_to_power(
            power_name, limit=3
        )

        # Debug logging to verify messages
        logger.info(
            f"[{power_name}] Found {len(recent_messages_to_power)} high priority messages to respond to"
        )
        if recent_messages_to_power:
            for i, msg in enumerate(recent_messages_to_power):
                logger.info(
                    f"[{power_name}] Priority message {i + 1}: From {msg['sender']} in {msg['phase']}: {msg['content'][:50]}..."
                )

        # Add a section for unanswered messages
        unanswered_messages = "\n\nRECENT MESSAGES REQUIRING YOUR ATTENTION:\n"
        if recent_messages_to_power:
            for msg in recent_messages_to_power:
                unanswered_messages += (
                    f"\nFrom {msg['sender']} in {msg['phase']}: {msg['content']}\n"
                )
        else:
            unanswered_messages += "\nNo urgent messages requiring direct responses.\n"

        return context + unanswered_messages + "\n\n" + instructions

    async def get_planning_reply(  # Renamed from get_plan to avoid conflict with get_plan in agent.py
        self,
        game,
        board_state,
        power_name: str,
        possible_orders: Dict[str, List[str]],
        game_history: GameHistory,
        game_phase: str,  # Used for logging
        log_file_path: str,  # Used for logging
        agent_goals: Optional[List[str]] = None,
        agent_relationships: Optional[Dict[str, str]] = None,
        agent_private_diary_str: Optional[str] = None,  # Added
    ) -> str:
        prompt = self.build_planning_prompt(
            game,
            board_state,
            power_name,
            possible_orders,
            game_history,
            # game_phase, # Not passed to build_planning_prompt directly
            # log_file_path, # Not passed to build_planning_prompt directly
            agent_goals=agent_goals,
            agent_relationships=agent_relationships,
            agent_private_diary_str=agent_private_diary_str,  # Pass diary string
        )

        # Call LLM using the logging wrapper
        raw_response = await run_llm_and_log(
            client=self,
            prompt=prompt,
            log_file_path=log_file_path,
            power_name=power_name,
            phase=game_phase,  # Use game_phase for logging
            response_type="plan_reply",  # Changed from 'plan' to avoid confusion
        )
        logger.debug(
            f"[{self.model_name}] Raw LLM response for {power_name} planning reply:\n{raw_response}"
        )
        return raw_response

    async def get_conversation_reply(
        self,
        game,
        board_state,
        power_name: str,
        possible_orders: Dict[str, List[str]],
        game_history: GameHistory,
        game_phase: str,
        log_file_path: str,
        active_powers: Optional[List[str]] = None,
        agent_goals: Optional[List[str]] = None,
        agent_relationships: Optional[Dict[str, str]] = None,
        agent_private_diary_str: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """
        Generates a negotiation message, considering agent state.
        """
        raw_input_prompt = ""  # Initialize for finally block
        raw_response = ""  # Initialize for finally block
        success_status = "Failure: Initialized"  # Default status
        messages_to_return = []  # Initialize to ensure it's defined

        try:
            raw_input_prompt = self.build_conversation_prompt(
                game,
                board_state,
                power_name,
                possible_orders,
                game_history,
                agent_goals=agent_goals,
                agent_relationships=agent_relationships,
                agent_private_diary_str=agent_private_diary_str,
            )

            logger.debug(
                f"[{self.model_name}] Conversation prompt for {power_name}:\n{raw_input_prompt}"
            )

            raw_response = await run_llm_and_log(
                client=self,
                prompt=raw_input_prompt,
                log_file_path=log_file_path,
                power_name=power_name,
                phase=game_phase,
                response_type="negotiation",  # For run_llm_and_log's internal context
            )
            logger.debug(
                f"[{self.model_name}] Raw LLM response for {power_name}:\n{raw_response}"
            )

            parsed_messages = []
            json_blocks = []
            json_decode_error_occurred = False

            # Attempt to find blocks enclosed in {{...}}
            double_brace_blocks = re.findall(r"\{\{(.*?)\}\}", raw_response, re.DOTALL)
            if double_brace_blocks:
                # If {{...}} blocks are found, assume each is a self-contained JSON object
                json_blocks.extend(
                    ["{" + block.strip() + "}" for block in double_brace_blocks]
                )
            else:
                # If no {{...}} blocks, look for ```json ... ``` markdown blocks
                code_block_match = re.search(
                    r"```json\n(.*?)\n```", raw_response, re.DOTALL
                )
                if code_block_match:
                    potential_json_array_or_objects = code_block_match.group(1).strip()
                    # Try to parse as a list of objects or a single object
                    try:
                        data = json.loads(potential_json_array_or_objects)
                        if isinstance(data, list):
                            json_blocks = [
                                json.dumps(item)
                                for item in data
                                if isinstance(item, dict)
                            ]
                        elif isinstance(data, dict):
                            json_blocks = [json.dumps(data)]
                    except json.JSONDecodeError:
                        # If parsing the whole block fails, fall back to regex for individual objects
                        json_blocks = re.findall(
                            r"\{.*?\}", potential_json_array_or_objects, re.DOTALL
                        )
                else:
                    # If no markdown block, fall back to regex for any JSON object in the response
                    json_blocks = re.findall(r"\{.*?\}", raw_response, re.DOTALL)

            if not json_blocks:
                logger.warning(
                    f"[{self.model_name}] No JSON message blocks found in response for {power_name}. Raw response:\n{raw_response}"
                )
                success_status = "Success: No JSON blocks found"
                # messages_to_return remains empty
            else:
                for block_index, block in enumerate(json_blocks):
                    try:
                        cleaned_block = block.strip()
                        # Attempt to fix common JSON issues like trailing commas before parsing
                        cleaned_block = re.sub(r",\s*([\}\]])", r"\1", cleaned_block)
                        parsed_message = json.loads(cleaned_block)

                        if (
                            isinstance(parsed_message, dict)
                            and "message_type" in parsed_message
                            and "content" in parsed_message
                        ):
                            # Further validation, e.g., recipient for private messages
                            if (
                                parsed_message["message_type"] == "private"
                                and "recipient" not in parsed_message
                            ):
                                logger.warning(
                                    f"[{self.model_name}] Private message missing recipient for {power_name} in block {block_index}. Skipping: {cleaned_block}"
                                )
                                continue  # Skip this message
                            parsed_messages.append(parsed_message)
                        else:
                            logger.warning(
                                f"[{self.model_name}] Invalid message structure or missing keys in block {block_index} for {power_name}: {cleaned_block}"
                            )

                    except json.JSONDecodeError as jde:
                        # Try to fix unescaped newlines and retry parsing
                        try:
                            # Fix unescaped newlines and other control characters in JSON strings
                            def escape_json_string(match):
                                # Get the string content (without quotes)
                                string_content = match.group(1)
                                # Escape newlines, tabs, and carriage returns
                                string_content = string_content.replace("\n", "\\n")
                                string_content = string_content.replace("\r", "\\r")
                                string_content = string_content.replace("\t", "\\t")
                                # Return with quotes
                                return '"' + string_content + '"'

                            # Apply escaping to all string values in the JSON
                            fixed_block = re.sub(
                                r'"([^"]*)"', escape_json_string, cleaned_block
                            )

                            # Try parsing again with fixed block
                            parsed_message = json.loads(fixed_block)

                            if (
                                isinstance(parsed_message, dict)
                                and "message_type" in parsed_message
                                and "content" in parsed_message
                            ):
                                # Further validation, e.g., recipient for private messages
                                if (
                                    parsed_message["message_type"] == "private"
                                    and "recipient" not in parsed_message
                                ):
                                    logger.warning(
                                        f"[{self.model_name}] Private message missing recipient for {power_name} in block {block_index}. Skipping: {fixed_block}"
                                    )
                                    continue  # Skip this message
                                parsed_messages.append(parsed_message)
                                logger.info(
                                    f"[{self.model_name}] Successfully parsed JSON block {block_index} for {power_name} after fixing escape sequences"
                                )
                            else:
                                logger.warning(
                                    f"[{self.model_name}] Invalid message structure or missing keys in block {block_index} for {power_name} after escape fix: {fixed_block}"
                                )
                        except json.JSONDecodeError as jde2:
                            json_decode_error_occurred = True
                            logger.warning(
                                f"[{self.model_name}] Failed to decode JSON block {block_index} for {power_name} even after escape fixes. Error: {jde}. Block content:\n{block}"
                            )

                if parsed_messages:
                    success_status = "Success: Messages extracted"
                    messages_to_return = parsed_messages
                elif json_decode_error_occurred:
                    success_status = "Failure: JSONDecodeError during block parsing"
                    messages_to_return = []
                else:  # JSON blocks found, but none were valid messages
                    success_status = (
                        "Success: No valid messages extracted from JSON blocks"
                    )
                    messages_to_return = []

            logger.debug(
                f"[{self.model_name}] Validated conversation replies for {power_name}: {messages_to_return}"
            )
            # return messages_to_return # Return will happen in finally block or after

        except Exception as e:
            logger.error(
                f"[{self.model_name}] Error in get_conversation_reply for {power_name}: {e}",
                exc_info=True,
            )
            success_status = f"Failure: Exception ({type(e).__name__})"
            messages_to_return = []  # Ensure empty list on general exception
        finally:
            if log_file_path:
                log_llm_response(
                    log_file_path=log_file_path,
                    model_name=self.model_name,
                    power_name=power_name,
                    phase=game_phase,
                    response_type="negotiation_message",
                    raw_input_prompt=raw_input_prompt,
                    raw_response=raw_response,
                    success=success_status,
                )
            return messages_to_return

    async def get_plan(  # This is the original get_plan, now distinct from get_planning_reply
        self,
        game,
        board_state,
        power_name: str,
        # possible_orders: Dict[str, List[str]], # Not typically needed for high-level plan
        game_history: GameHistory,
        log_file_path: str,
        agent_goals: Optional[List[str]] = None,
        agent_relationships: Optional[Dict[str, str]] = None,
        agent_private_diary_str: Optional[str] = None,  # Added
    ) -> str:
        """
        Generates a strategic plan for the given power based on the current state.
        This method is called by the agent's generate_plan method.
        """
        logger.info(f"Client generating strategic plan for {power_name}...")

        planning_instructions = load_prompt("planning_instructions.txt")
        if not planning_instructions:
            logger.error(
                "Could not load planning_instructions.txt! Cannot generate plan."
            )
            return "Error: Planning instructions not found."

        # For planning, possible_orders might be less critical for the context,
        # but build_context_prompt expects it. We can pass an empty dict or calculate it.
        # For simplicity, let's pass empty if not strictly needed by context for planning.
        possible_orders_for_context = {}  # game.get_all_possible_orders() if needed by context

        context_prompt = self.build_context_prompt(
            game,
            board_state,
            power_name,
            possible_orders_for_context,
            game_history,
            agent_goals=agent_goals,
            agent_relationships=agent_relationships,
            agent_private_diary=agent_private_diary_str,  # Pass diary string
        )

        full_prompt = f"{context_prompt}\n\n{planning_instructions}"
        if self.system_prompt:
            full_prompt = f"{self.system_prompt}\n\n{full_prompt}"

        raw_plan_response = ""
        success_status = "Failure: Initialized"
        plan_to_return = (
            f"Error: Plan generation failed for {power_name} (initial state)"
        )

        try:
            # Use run_llm_and_log for the actual LLM call
            raw_plan_response = await run_llm_and_log(
                client=self,  # Pass self (the client instance)
                prompt=full_prompt,
                log_file_path=log_file_path,
                power_name=power_name,
                phase=game.current_short_phase,
                response_type="plan_generation",  # More specific type for run_llm_and_log context
            )
            logger.debug(
                f"[{self.model_name}] Raw LLM response for {power_name} plan generation:\n{raw_plan_response}"
            )
            # No parsing needed for the plan, return the raw string
            plan_to_return = raw_plan_response.strip()
            success_status = "Success"
        except Exception as e:
            logger.error(
                f"Failed to generate plan for {power_name}: {e}", exc_info=True
            )
            success_status = f"Failure: Exception ({type(e).__name__})"
            plan_to_return = (
                f"Error: Failed to generate plan for {power_name} due to exception: {e}"
            )
        finally:
            if log_file_path:  # Only log if a path is provided
                log_llm_response(
                    log_file_path=log_file_path,
                    model_name=self.model_name,
                    power_name=power_name,
                    phase=game.current_short_phase if game else "UnknownPhase",
                    response_type="plan_generation",  # Specific type for CSV logging
                    raw_input_prompt=full_prompt,  # Renamed from 'full_prompt' to match log_llm_response arg
                    raw_response=raw_plan_response,
                    success=success_status,
                    # token_usage and cost can be added later
                )
        return plan_to_return


##############################################################################
# 2) Concrete Implementations
##############################################################################


class OpenAIClient(BaseModelClient):
    """
    For 'o3-mini', 'gpt-4o', or other OpenAI model calls.
    """

    def __init__(self, model_name: str):
        super().__init__(model_name)
        self.client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    async def generate_response(self, prompt: str) -> str:
        # Updated to new API format
        try:
            # Append the call to action to the user's prompt
            prompt_with_cta = prompt + "\n\nPROVIDE YOUR RESPONSE BELOW:"

            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": prompt_with_cta},
                ],
            )
            if not response or not hasattr(response, "choices") or not response.choices:
                logger.warning(
                    f"[{self.model_name}] Empty or invalid result in generate_response. Returning empty."
                )
                return ""
            return response.choices[0].message.content.strip()
        except json.JSONDecodeError as json_err:
            logger.error(
                f"[{self.model_name}] JSON decoding failed in generate_response: {json_err}"
            )
            return ""
        except Exception as e:
            logger.error(
                f"[{self.model_name}] Unexpected error in generate_response: {e}"
            )
            return ""


class ClaudeClient(BaseModelClient):
    """
    For 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', etc.
    """

    def __init__(self, model_name: str):
        super().__init__(model_name)
        self.client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    async def generate_response(self, prompt: str) -> str:
        # Updated Claude messages format
        try:
            response = await self.client.messages.create(
                model=self.model_name,
                max_tokens=4000,
                system=self.system_prompt,  # system is now a top-level parameter
                messages=[
                    {
                        "role": "user",
                        "content": prompt + "\n\nPROVIDE YOUR RESPONSE BELOW:",
                    }
                ],
            )
            if not response.content:
                logger.warning(
                    f"[{self.model_name}] Empty content in Claude generate_response. Returning empty."
                )
                return ""
            return response.content[0].text.strip() if response.content else ""
        except json.JSONDecodeError as json_err:
            logger.error(
                f"[{self.model_name}] JSON decoding failed in generate_response: {json_err}"
            )
            return ""
        except Exception as e:
            logger.error(
                f"[{self.model_name}] Unexpected error in generate_response: {e}"
            )
            return ""


class GeminiClient(BaseModelClient):
    """
    For 'gemini-1.5-flash' or other Google Generative AI models.
    """

    def __init__(self, model_name: str):
        super().__init__(model_name)
        # Configure and get the model (corrected initialization)
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")
        genai.configure(api_key=api_key)
        self.client = genai.GenerativeModel(model_name)
        logger.debug(
            f"[{self.model_name}] Initialized Gemini client (genai.GenerativeModel)"
        )

    async def generate_response(self, prompt: str) -> str:
        full_prompt = self.system_prompt + prompt + "\n\nPROVIDE YOUR RESPONSE BELOW:"

        try:
            response = await self.client.generate_content_async(
                contents=full_prompt,
            )

            if not response or not response.text:
                logger.warning(
                    f"[{self.model_name}] Empty Gemini generate_response. Returning empty."
                )
                return ""
            return response.text.strip()
        except Exception as e:
            logger.error(f"[{self.model_name}] Error in Gemini generate_response: {e}")
            return ""


class DeepSeekClient(BaseModelClient):
    """
    For DeepSeek R1 'deepseek-reasoner'
    """

    def __init__(self, model_name: str):
        super().__init__(model_name)
        self.api_key = os.environ.get("DEEPSEEK_API_KEY")
        self.client = AsyncDeepSeekOpenAI(
            api_key=self.api_key, base_url="https://api.deepseek.com/"
        )

    async def generate_response(self, prompt: str) -> str:
        try:
            # Append the call to action to the user's prompt
            prompt_with_cta = prompt + "\n\nPROVIDE YOUR RESPONSE BELOW:"

            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": prompt_with_cta},
                ],
                stream=False,
            )

            logger.debug(f"[{self.model_name}] Raw DeepSeek response:\n{response}")

            if not response or not response.choices:
                logger.warning(
                    f"[{self.model_name}] No valid response in generate_response."
                )
                return ""

            content = response.choices[0].message.content.strip()
            if not content:
                logger.warning(f"[{self.model_name}] DeepSeek returned empty content.")
                return ""
            return content

        except Exception as e:
            logger.error(
                f"[{self.model_name}] Unexpected error in generate_response: {e}"
            )
            return ""


class OpenAIResponsesClient(BaseModelClient):
    """
    For OpenAI o3-pro model using the new Responses API endpoint.
    This client makes direct HTTP requests to the v1/responses endpoint.
    """

    def __init__(self, model_name: str):
        super().__init__(model_name)
        self.api_key = os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        self.base_url = "https://api.openai.com/v1/responses"
        logger.info(f"[{self.model_name}] Initialized OpenAI Responses API client")

    async def generate_response(self, prompt: str) -> str:
        try:
            # The Responses API uses a different format than chat completions
            # Combine system prompt and user prompt into a single input
            full_prompt = (
                f"{self.system_prompt}\n\n{prompt}\n\nPROVIDE YOUR RESPONSE BELOW:"
            )

            # Prepare the request payload
            payload = {"model": self.model_name, "input": full_prompt}

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            }

            # Make the API call using aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.base_url, json=payload, headers=headers
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(
                            f"[{self.model_name}] API error (status {response.status}): {error_text}"
                        )
                        return ""

                    response_data = await response.json()

                    # Extract the text from the nested response structure
                    # The text is in output[1].content[0].text based on the response
                    try:
                        outputs = response_data.get("output", [])
                        if len(outputs) < 2:
                            logger.warning(
                                f"[{self.model_name}] Unexpected output structure. Full response: {response_data}"
                            )
                            return ""

                        # The message is typically in the second output item
                        message_output = outputs[1]
                        if message_output.get("type") != "message":
                            logger.warning(
                                f"[{self.model_name}] Expected message type in output[1]. Got: {message_output.get('type')}"
                            )
                            return ""

                        content_list = message_output.get("content", [])
                        if not content_list:
                            logger.warning(
                                f"[{self.model_name}] Empty content list in message output"
                            )
                            return ""

                        # Look for the content item with type 'output_text'
                        text_content = ""
                        for content_item in content_list:
                            if content_item.get("type") == "output_text":
                                text_content = content_item.get("text", "")
                                break

                        if not text_content:
                            logger.warning(
                                f"[{self.model_name}] No output_text found in content. Full content: {content_list}"
                            )
                            return ""

                        return text_content.strip()

                    except (KeyError, IndexError, TypeError) as e:
                        logger.error(
                            f"[{self.model_name}] Error parsing response structure: {e}. Full response: {response_data}"
                        )
                        return ""

        except aiohttp.ClientError as e:
            logger.error(
                f"[{self.model_name}] HTTP client error in generate_response: {e}"
            )
            return ""
        except Exception as e:
            logger.error(
                f"[{self.model_name}] Unexpected error in generate_response: {e}"
            )
            return ""


class OpenRouterClient(BaseModelClient):
    """
    For OpenRouter models, with default being 'openrouter/quasar-alpha'
    """

    def __init__(self, model_name: str = "openrouter/quasar-alpha"):
        # Allow specifying just the model identifier or the full path
        if not model_name.startswith("openrouter/") and "/" not in model_name:
            model_name = f"openrouter/{model_name}"
        if model_name.startswith("openrouter-"):
            model_name = model_name.replace("openrouter-", "")

        super().__init__(model_name)
        self.api_key = os.environ.get("OPENROUTER_API_KEY")
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")

        self.client = AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1", api_key=self.api_key
        )

        logger.debug(f"[{self.model_name}] Initialized OpenRouter client")

    async def generate_response(self, prompt: str) -> str:
        """Generate a response using OpenRouter with robust error handling."""
        try:
            # Append the call to action to the user's prompt
            prompt_with_cta = prompt + "\n\nPROVIDE YOUR RESPONSE BELOW:"

            # Prepare standard OpenAI-compatible request
            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": prompt_with_cta},
                ],
                max_tokens=4000,
            )

            if not response.choices:
                logger.warning(f"[{self.model_name}] OpenRouter returned no choices")
                return ""

            content = response.choices[0].message.content.strip()
            if not content:
                logger.warning(f"[{self.model_name}] OpenRouter returned empty content")
                return ""

            # Parse or return the raw content
            return content

        except Exception as e:
            error_msg = str(e)
            # Check if it's a specific OpenRouter error
            if "429" in error_msg or "rate" in error_msg.lower():
                logger.warning(f"[{self.model_name}] OpenRouter rate limit error: {e}")
                # The retry logic in run_llm_and_log will handle this
                raise e  # Re-raise to trigger retry
            elif "provider" in error_msg.lower() and "error" in error_msg.lower():
                logger.error(f"[{self.model_name}] OpenRouter provider error: {e}")
                # This might be a temporary issue with the upstream provider
                raise e  # Re-raise to trigger retry or fallback
            else:
                logger.error(
                    f"[{self.model_name}] Error in OpenRouter generate_response: {e}"
                )
                return ""


##############################################################################
# 3) Factory to Load Model Client
##############################################################################


def load_model_client(model_id: str) -> BaseModelClient:
    """
    Returns the appropriate LLM client for a given model_id string.

    Args:
        model_id: The model identifier

    Example usage:
       client = load_model_client("claude-3-5-sonnet-20241022")
    """
    # Basic pattern matching or direct mapping
    lower_id = model_id.lower()

    # Check for o3-pro model specifically - it needs the Responses API
    if lower_id == "o3-pro":
        return OpenAIResponsesClient(model_id)
    # Check for OpenRouter first to handle prefixed models like openrouter-deepseek
    elif "openrouter" in lower_id or "quasar" in lower_id:
        return OpenRouterClient(model_id)
    elif "claude" in lower_id:
        return ClaudeClient(model_id)
    elif "gemini" in lower_id:
        return GeminiClient(model_id)
    elif "deepseek" in lower_id:
        return DeepSeekClient(model_id)
    else:
        # Default to OpenAI (for models like o3-mini, gpt-4o, etc.)
        return OpenAIClient(model_id)


##############################################################################
# 4) Example Usage in a Diplomacy "main" or Similar
##############################################################################


async def example_game_loop(game):
    """
    Pseudocode: Integrate with the Diplomacy loop.
    """
    # Suppose we gather all active powers
    active_powers = [
        (p_name, p_obj)
        for p_name, p_obj in game.powers.items()
        if not p_obj.is_eliminated()
    ]
    power_model_mapping = assign_models_to_powers()

    for power_name, power_obj in active_powers:
        model_id = power_model_mapping.get(power_name, "o3-mini")
        client = load_model_client(model_id)

        # Get possible orders from the game
        possible_orders = game.get_all_possible_orders()
        board_state = game.get_state()

        # Example: Fetch agent instance (assuming agents are stored in a dict)
        # agent = agents_dict[power_name]
        # formatted_diary = agent.format_private_diary_for_prompt()

        # Get orders from the client
        # orders = await client.get_orders(
        #     board_state,
        #     power_name,
        #     possible_orders,
        #     agent_private_diary_str=formatted_diary # Pass the diary
        # )
        # game.set_orders(power_name, orders)

    # Then process, etc.
    game.process()


class LMServiceVersus:
    """
    Optional wrapper class if you want extra control.
    For example, you could store or reuse clients, etc.
    """

    def __init__(self):
        self.power_model_map = assign_models_to_powers()

    async def get_orders_for_power(self, game, power_name, agent):  # Added agent
        model_id = self.power_model_map.get(power_name, "o3-mini")
        client = load_model_client(model_id)
        possible_orders = gather_possible_orders(game, power_name)
        board_state = game.get_state()

        formatted_diary = (
            agent.format_private_diary_for_prompt()
        )  # Get diary from agent

        # This method signature in LMServiceVersus might need to align with client.get_orders
        # or client.get_orders needs to be called with all its required params.
        # For now, assuming client.get_orders is called elsewhere with full context.
        # This example shows how to get the diary string.
        # return await client.get_orders(
        #    board_state, power_name, possible_orders, agent_private_diary_str=formatted_diary
        # )
        pass  # Placeholder for actual call


##############################################################################
# 1) Add a method to filter visible messages (near top-level or in BaseModelClient)
##############################################################################
def get_visible_messages_for_power(conversation_messages, power_name):
    """
    Returns a chronological subset of conversation_messages that power_name can legitimately see.
    """
    visible = []
    for msg in conversation_messages:
        # GLOBAL might be 'ALL' or 'GLOBAL' depending on your usage
        if (
            msg["recipient"] == "ALL"
            or msg["recipient"] == "GLOBAL"
            or msg["sender"] == power_name
            or msg["recipient"] == power_name
        ):
            visible.append(msg)
    return visible  # already in chronological order if appended that way

