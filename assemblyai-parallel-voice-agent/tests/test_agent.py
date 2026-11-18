"""Import-level checks that the agent wires up without any network calls."""


def test_agent_builds(monkeypatch):
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "test")
    import agent

    a = agent.SearchAssistant()
    assert "web_search" in a.instructions
    assert "San Francisco" in a.instructions
    assert "food" in a.instructions
    assert "utility" in a.instructions
    assert "Social Security" in a.instructions
    assert "AidLine" in agent.GREETING
