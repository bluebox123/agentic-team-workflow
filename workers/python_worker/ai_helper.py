"""
AI Helper Module - Centralized AI Integration
Handles Perplexity, Gemini and SambaNova API calls with smart routing and rate limiting
"""

import os
import time
from typing import Optional, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# Try to import Perplexity client
try:
    from perplexity import Perplexity
    PERPLEXITY_AVAILABLE = True
except ImportError:
    PERPLEXITY_AVAILABLE = False
    print("[AI_HELPER] WARNING: perplexity library not installed")

# Try to import Gemini
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("[AI_HELPER] WARNING: google.generativeai not installed")

from openai import OpenAI

# Load API keys from environment
PPLX_API_KEY = os.getenv("PPLX_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-exp")

SAMBANOVA_API_KEY = os.getenv("SAMBANOVA_API_KEY")
SAMBANOVA_BASE_URL = os.getenv("SAMBANOVA_BASE_URL", "https://api.sambanova.ai/v1")
SAMBANOVA_MODEL = os.getenv("SAMBANOVA_MODEL", "deepseek-r1-distill-llama-70b")

# Rate limiting tracking
_last_perplexity_call = 0
_last_gemini_call = 0
_last_sambanova_call = 0
RATE_LIMIT_DELAY = 1.0  # seconds between calls

# Initialize Perplexity client
perplexity_client = None
if PERPLEXITY_AVAILABLE and PPLX_API_KEY:
    try:
        perplexity_client = Perplexity()
        print("[AI_HELPER] Perplexity initialized")
    except Exception as e:
        print(f"[AI_HELPER] Perplexity init failed: {e}")
else:
    print("[AI_HELPER] Perplexity not available")

# Initialize Gemini
if GEMINI_AVAILABLE and GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    print("[AI_HELPER] Gemini initialized")

# Initialize SambaNova
sambanova_client = None
if SAMBANOVA_API_KEY:
    sambanova_client = OpenAI(api_key=SAMBANOVA_API_KEY, base_url=SAMBANOVA_BASE_URL)
    print("[AI_HELPER] SambaNova initialized")


class AIException(Exception):
    pass


class RateLimitException(AIException):
    pass


def _wait_for_rate_limit(provider: str):
    global _last_perplexity_call, _last_gemini_call, _last_sambanova_call
    
    if provider == "perplexity":
        elapsed = time.time() - _last_perplexity_call
        if elapsed < RATE_LIMIT_DELAY:
            time.sleep(RATE_LIMIT_DELAY - elapsed)
        _last_perplexity_call = time.time()
    elif provider == "gemini":
        elapsed = time.time() - _last_gemini_call
        if elapsed < RATE_LIMIT_DELAY:
            time.sleep(RATE_LIMIT_DELAY - elapsed)
        _last_gemini_call = time.time()
    elif provider == "sambanova":
        elapsed = time.time() - _last_sambanova_call
        if elapsed < RATE_LIMIT_DELAY:
            time.sleep(RATE_LIMIT_DELAY - elapsed)
        _last_sambanova_call = time.time()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10), retry=retry_if_exception_type(RateLimitException))
def generate_with_perplexity(prompt: str, preset: str = "pro-search", max_tokens: int = 2000) -> str:
    if not perplexity_client:
        raise AIException("Perplexity client not configured")
    
    _wait_for_rate_limit("perplexity")
    
    try:
        response = perplexity_client.responses.create(preset=preset, input=prompt)
        if not response or not response.output_text:
            raise AIException("Empty response from Perplexity")
        return response.output_text.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "rate" in error_msg or "quota" in error_msg or "429" in error_msg:
            raise RateLimitException(f"Perplexity rate limit: {e}")
        else:
            raise AIException(f"Perplexity generation failed: {e}")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10), retry=retry_if_exception_type(RateLimitException))
def generate_with_gemini(prompt: str, temperature: float = 0.7, max_tokens: int = 2000) -> str:
    if not GEMINI_AVAILABLE or not GEMINI_API_KEY:
        raise AIException("Gemini API key not configured")
    
    _wait_for_rate_limit("gemini")
    
    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        response = model.generate_content(prompt, generation_config=genai.GenerationConfig(temperature=temperature, max_output_tokens=max_tokens))
        if not response.text:
            raise AIException("Empty response from Gemini")
        return response.text.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "rate" in error_msg or "quota" in error_msg or "429" in error_msg:
            raise RateLimitException(f"Gemini rate limit: {e}")
        else:
            raise AIException(f"Gemini generation failed: {e}")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10), retry=retry_if_exception_type(RateLimitException))
def generate_with_sambanova(prompt: str, temperature: float = 0.7, max_tokens: int = 2000) -> str:
    if not sambanova_client:
        raise AIException("SambaNova API key not configured")
    
    _wait_for_rate_limit("sambanova")
    
    try:
        response = sambanova_client.chat.completions.create(model=SAMBANOVA_MODEL, messages=[{"role": "user", "content": prompt}], temperature=temperature, max_tokens=max_tokens)
        if not response.choices or not response.choices[0].message.content:
            raise AIException("Empty response from SambaNova")
        return response.choices[0].message.content.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "rate" in error_msg or "quota" in error_msg or "429" in error_msg:
            raise RateLimitException(f"SambaNova rate limit: {e}")
        else:
            raise AIException(f"SambaNova generation failed: {e}")


def generate_ai_response(prompt: str, task_type: str = "general", prefer_perplexity: bool = True, temperature: float = 0.7, max_tokens: int = 2000) -> str:
    if prefer_perplexity and perplexity_client:
        providers = ["perplexity", "sambanova", "gemini"]
    else:
        providers = ["sambanova", "perplexity", "gemini"]
    
    for provider in providers:
        try:
            if provider == "perplexity" and perplexity_client:
                print(f"[AI_HELPER] Using Perplexity for {task_type} task")
                return generate_with_perplexity(prompt, max_tokens=max_tokens)
            elif provider == "gemini" and GEMINI_AVAILABLE and GEMINI_API_KEY:
                print(f"[AI_HELPER] Using Gemini for {task_type} task")
                return generate_with_gemini(prompt, temperature, max_tokens)
            elif provider == "sambanova" and sambanova_client:
                print(f"[AI_HELPER] Using SambaNova for {task_type} task")
                return generate_with_sambanova(prompt, temperature, max_tokens)
        except RateLimitException:
            print(f"[AI_HELPER] {provider} rate limited, trying fallback...")
            continue
        except AIException as e:
            print(f"[AI_HELPER] {provider} failed: {e}, trying fallback...")
            continue
    
    raise AIException("All AI providers failed or not configured")


def extract_json_from_response(response: str) -> Optional[Dict[str, Any]]:
    import json
    import re
    
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass
    
    json_match = re.search(r"\{[^{}]*\}", response)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass
    
    return None


__all__ = ["generate_with_perplexity", "generate_with_gemini", "generate_with_sambanova", "generate_ai_response", "extract_json_from_response", "AIException", "RateLimitException"]
