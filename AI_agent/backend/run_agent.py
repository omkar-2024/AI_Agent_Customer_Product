from agent.agent_loop import run_query

if __name__ == "__main__":
    print("AI Agent - type 'exit' to quit\n")
    while True:
        query = input("You: ")
        if query.strip().lower() == "exit":
            break
        result = run_query(query)
        answer = result.get("answer", result) if isinstance(result, dict) else result
        print(f"\nAgent: {answer}\n")
