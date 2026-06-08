"""RAG retrieval layer (KAN-6).

Public surface:
  ingest_attachment(chat_id, attachment)  — chunk + embed an uploaded file into `documents`
  RETRIEVAL_GRAPH                          — compiled retrieval subgraph (nested node in the agent graph)
  retrieve_documents                       — tool schema the agent calls to enter the subgraph
"""
