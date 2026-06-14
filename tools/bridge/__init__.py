"""Eva ACP Bridge - modular package.

For backward compatibility, ``import bridge`` or loading via
``importlib.util.spec_from_file_location("acp_bridge", "tools/acp_bridge.py")``
exposes the same public symbols that the monolith did.
"""

# Re-export everything from the core module so existing tests and imports
# continue to work unchanged (e.g. acp_bridge._valid_artifact_name).
from bridge.core import *  # noqa: F401,F403
from bridge.core import (  # explicit re-exports used by tests
    _valid_artifact_name,
    main,
)

__all__ = ["main", "_valid_artifact_name"]
