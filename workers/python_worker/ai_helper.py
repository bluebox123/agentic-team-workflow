"""
AI Helper Module - Centralized AI Integration
Handles Gemini and SambaNova API calls with smart routing and rate limiting
"""

import os
import time
from typing import Optional, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import google.generativeai as genai
from openai import OpenAI

# Load API keys from environment
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-exp")

SAMBANOVA_API_KEY = os.getenv("SAMBANOVA_API_KEY")
SAMBANOVA_BASE_URL = os.getenv("SAMBANOVA_BASE_URL", "https://api.sambanova.ai/v1")
SAMBANOVA_MODEL = os.getenv("SAMBANOVA_MODEL", "deepseek-r1-distill-llama-70b")

# Rate limiting tracking
_last_gemini_call = 0
_last_sambanova_call = 0
RATE_LIMIT_DELAY = 1.0  # seconds between calls

# Initialize Gemini
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    print(f"[AI_HELPER] Gemini initialized with model: {GEMINI_MODEL}")
else:
    print("[AI_HELPER] WARNING: GEMINI_API_KEY not set")

# Initialize SambaNova (OpenAI-compatible)
sambanova_client = None
if SAMBANOVA_API_KEY:
    sambanova_client = OpenAI(
        api_key=SAMBANOVA_API_KEY,
        base_url=SAMBANOVA_BASE_URL
    )
    print(f"[AI_HELPER] SambaNova initialized with model: {SAMBANOVA_MODEL}")
else:
    print("[AI_HELPER] WARNING: SAMBANOVA_API_KEY not set")


class AIException(Exception):
    """Base exception for AI-related errors"""
    pass


class RateLimitException(AIException):
    """Raised when rate limit is hit"""
    pass


def _wait_for_rate_limit(provider: str):
    """Implement rate limiting between API calls"""
    global _last_gemini_call, _last_sambanova_call
    
    if provider == "gemini":
        elapsed = time.time() - _last_gemini_call
        if elapsed < RATE_LIMIT_DELAY:
            time.sleep(RATE_LIMIT_DELAY - elapsed)
        _last_gemini_call = time.time()
    elif provider == "sambanova":
        elapsed = time.time() - _last_sambanova_call
        if elapsed < RATE_LIMIT_DELAY:
            time.sleep(RATE_LIMIT_DELAY - elapsed)
        _last_sambanova_call = time.time()


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(RateLimitException)
)
def generate_with_gemini(
    prompt: str, 
    temperature: float = 0.7,
    max_tokens: int = 2000
) -> str:
    """
    Generate text using Gemini API with retry logic
    
    Args:
        prompt: Input prompt for the model
        temperature: Sampling temperature (0.0 to 1.0)
        max_tokens: Maximum tokens to generate
        
    Returns:
        Generated text response
        
    Raises:
        AIException: If generation fails after retries
    """
    if not GEMINI_API_KEY:
        raise AIException("Gemini API key not configured")
    
    _wait_for_rate_limit("gemini")
    
    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            )
        )
        
        if not response.text:
            raise AIException("Empty response from Gemini")
            
        return response.text.strip()
        
    except Exception as e:
        error_msg = str(e).lower()
        if "rate" in error_msg or "quota" in error_msg or "429" in error_msg:
            print(f"[AI_HELPER] Gemini rate limit hit: {e}")
            raise RateLimitException(f"Gemini rate limit: {e}")
        else:
            print(f"[AI_HELPER] Gemini error: {e}")
            raise AIException(f"Gemini generation failed: {e}")


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(RateLimitException)
)
def generate_with_sambanova(
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 2000
) -> str:
    """
    Generate text using SambaNova API (OpenAI-compatible) with retry logic
    
    Args:
        prompt: Input prompt for the model
        temperature: Sampling temperature (0.0 to 1.0)
        max_tokens: Maximum tokens to generate
        
    Returns:
        Generated text response
        
    Raises:
        AIException: If generation fails after retries
    """
    if not sambanova_client:
        raise AIException("SambaNova API key not configured")
    
    _wait_for_rate_limit("sambanova")
    
    try:
        response = sambanova_client.chat.completions.create(
            model=SAMBANOVA_MODEL,
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=temperature,
            max_tokens=max_tokens
        )
        
        if not response.choices or not response.choices[0].message.content:
            raise AIException("Empty response from SambaNova")
            
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        error_msg = str(e).lower()
        if "rate" in error_msg or "quota" in error_msg or "429" in error_msg:
            print(f"[AI_HELPER] SambaNova rate limit hit: {e}")
            raise RateLimitException(f"SambaNova rate limit: {e}")
        else:
            print(f"[AI_HELPER] SambaNova error: {e}")
            raise AIException(f"SambaNova generation failed: {e}")


def generate_ai_response(
    prompt: str,
    task_type: str = "general",
    prefer_gemini: bool = True,
    temperature: float = 0.7,
    max_tokens: int = 2000
) -> str:
    """
    Generate AI response with smart provider selection and fallback
    
    Args:
        prompt: Input prompt
        task_type: Type of task (affects model selection)
        prefer_gemini: Whether to prefer Gemini over SambaNova
        temperature: Sampling temperature
        max_tokens: Maximum tokens to generate
        
    Returns:
        Generated text response
        
    Raises:
        AIException: If all providers fail
    """
    providers = ["gemini", "sambanova"] if prefer_gemini else ["sambanova", "gemini"]
    
    for provider in providers:
        try:
            if provider == "gemini" and GEMINI_API_KEY:
                print(f"[AI_HELPER] Using Gemini for {task_type} task")
                return generate_with_gemini(prompt, temperature, max_tokens)
            elif provider == "sambanova" and sambanova_client:
                print(f"[AI_HELPER] Using SambaNova for {task_type} task")
                return generate_with_sambanova(prompt, temperature, max_tokens)
        except RateLimitException as e:
            print(f"[AI_HELPER] {provider} rate limited, trying fallback...")
            continue
        except AIException as e:
            print(f"[AI_HELPER] {provider} failed: {e}, trying fallback...")
            continue
    
    raise AIException("All AI providers failed or not configured")


def extract_json_from_response(response: str) -> Optional[Dict[str, Any]]:
    """
    Extract JSON from AI response (handles code blocks)
    
    Args:
        response: AI response text
        
    Returns:
        Parsed JSON dict or None if parsing fails
    """
    import json
    import re
    
    # Try to find JSON in code blocks
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    # Try to parse the entire response as JSON
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass
    
    # Try to find any JSON-like structure
    json_match = re.search(r'\{[^{}]*\}', response)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass
    
    return None


# Export main functions
__all__ = [
    'generate_with_gemini',
    'generate_with_sambanova',
    'generate_ai_response',
    'extract_json_from_response',
    'AIException',
    'RateLimitException'
]
