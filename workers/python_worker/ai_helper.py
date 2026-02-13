"""
AI Helper Module - Centralized AI Integration
Handles Perplexity, Gemini and SambaNova API calls with smart routing and rate limiting
"""

import os
import time
from typing import Optional, Dict, Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

AI_PROVIDER = os.getenv("AI_PROVIDER", "perplexity").strip().lower()

# Try to import Gemini
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

from openai import OpenAI

# Try to import official Perplexity SDK client
try:
    from perplexity import Perplexity as PerplexitySDK
    PERPLEXITY_SDK_AVAILABLE = True
except ImportError:
    PERPLEXITY_SDK_AVAILABLE = False

# Load API keys from environment
def _get_perplexity_key():
    """Get Perplexity API key from environment, mapping PPLX_API_KEY to PERPLEXITY_API_KEY"""
    key = os.getenv("PERPLEXITY_API_KEY") or os.getenv("PPLX_API_KEY")
    if key and not os.getenv("PERPLEXITY_API_KEY"):
        os.environ["PERPLEXITY_API_KEY"] = key
    return key

PPLX_API_KEY = _get_perplexity_key()
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

# Client instances (initialized lazily)
_perplexity_client = None
_perplexity_sdk_client = None
_sambanova_client = None
_gemini_configured = False

def _init_perplexity():
    """Lazy initialization of Perplexity client"""
    global _perplexity_client, _perplexity_sdk_client
    
    if _perplexity_sdk_client or _perplexity_client:
        return True
    
    key = _get_perplexity_key()
    if not key:
        return False
    
    try:
        if PERPLEXITY_SDK_AVAILABLE:
            _perplexity_sdk_client = PerplexitySDK()
            print("[AI_HELPER] Perplexity initialized (SDK)")
        else:
            _perplexity_client = OpenAI(api_key=key, base_url="https://api.perplexity.ai")
            print("[AI_HELPER] Perplexity initialized (OpenAI-compatible)")
        return True
    except Exception as e:
        print(f"[AI_HELPER] Perplexity init failed: {e}")
        return False

def _init_gemini():
    """Lazy initialization of Gemini"""
    global _gemini_configured
    if _gemini_configured:
        return True
    if GEMINI_AVAILABLE and GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        _gemini_configured = True
        return True
    return False

def _init_sambanova():
    """Lazy initialization of SambaNova"""
    global _sambanova_client
    if _sambanova_client:
        return True
    if SAMBANOVA_API_KEY:
        _sambanova_client = OpenAI(api_key=SAMBANOVA_API_KEY, base_url=SAMBANOVA_BASE_URL)
        return True
    return False

# Initial status log
print(
    "[AI_HELPER] Provider config: "
    f"AI_PROVIDER={AI_PROVIDER}, "
    f"perplexity={'on' if bool(PPLX_API_KEY) else 'off'}, "
    f"gemini={'on' if (GEMINI_AVAILABLE and bool(GEMINI_API_KEY)) else 'off'}, "
    f"sambanova={'on' if bool(SAMBANOVA_API_KEY) else 'off'}"
)

if AI_PROVIDER == "perplexity":
    print(
        "[AI_HELPER] Perplexity key status: "
        f"PERPLEXITY_API_KEY={'set' if bool(os.getenv('PERPLEXITY_API_KEY')) else 'missing'}, "
        f"PPLX_API_KEY={'set' if bool(os.getenv('PPLX_API_KEY')) else 'missing'}"
    )


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
    # Initialize lazily if needed
    _init_perplexity()
    
    if not _perplexity_sdk_client and not _perplexity_client:
        raise AIException("Perplexity client not configured")
    
    _wait_for_rate_limit("perplexity")
    
    try:
        if _perplexity_sdk_client:
            response = _perplexity_sdk_client.responses.create(preset=preset, input=prompt)
            content = (getattr(response, "output_text", None) or "").strip()
            if not content:
                raise AIException("Empty response from Perplexity")
            return content
        
        response = _perplexity_client.chat.completions.create(
            model="sonar-pro",
            messages=[{"role": "user", "content": prompt}],
        )
        content = (response.choices[0].message.content or "").strip()
        if not content:
            raise AIException("Empty response from Perplexity")
        return content
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
    # Initialize lazily if needed
    if not _init_sambanova():
        raise AIException("SambaNova API key not configured")
    
    _wait_for_rate_limit("sambanova")
    
    try:
        response = _sambanova_client.chat.completions.create(model=SAMBANOVA_MODEL, messages=[{"role": "user", "content": prompt}], temperature=temperature, max_tokens=max_tokens)
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
    if AI_PROVIDER == "perplexity":
        # Initialize lazily
        if not _init_perplexity():
            raise AIException("AI_PROVIDER=perplexity but Perplexity client not configured (check PPLX_API_KEY and dependency install)")
        print(f"[AI_HELPER] Using Perplexity for {task_type} task")
        return generate_with_perplexity(prompt, max_tokens=max_tokens)

    # For other providers or fallback, initialize all lazily
    _init_perplexity()
    _init_sambanova()
    
    if prefer_perplexity and (_perplexity_sdk_client or _perplexity_client):
        providers = [("perplexity", _perplexity_sdk_client or _perplexity_client)]
    else:
        providers = []
    
    if _sambanova_client:
        providers.append(("sambanova", _sambanova_client))
    if _perplexity_sdk_client or _perplexity_client:
        if ("perplexity", _perplexity_sdk_client or _perplexity_client) not in providers:
            providers.append(("perplexity", _perplexity_sdk_client or _perplexity_client))
    
    for provider_name, client in providers:
        if not client:
            continue
        try:
            if provider_name == "perplexity":
                print(f"[AI_HELPER] Using Perplexity for {task_type} task")
                return generate_with_perplexity(prompt, max_tokens=max_tokens)
            elif provider_name == "sambanova":
                print(f"[AI_HELPER] Using SambaNova for {task_type} task")
                return generate_with_sambanova(prompt, temperature, max_tokens)
        except RateLimitException:
            print(f"[AI_HELPER] {provider_name} rate limited, trying fallback...")
            continue
        except AIException as e:
            print(f"[AI_HELPER] {provider_name} failed: {e}, trying fallback...")
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
