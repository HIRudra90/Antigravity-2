import uvicorn
import os

if __name__ == "__main__":
    # Ensure working directory is set to this file's folder for clean paths
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Run uvicorn server on localhost:8000 with auto-reload for local development
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
