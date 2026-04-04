## List with code {#list-with-code}

1. First, install the dependencies:

    ```bash
    pip install flask
    ```

2. Then, create the application:

    ```python
    # Create a basic web application
    from flask import Flask
    app = Flask(__name__)
    ```

3. Finally, start the server:

    ```python
    app.run(host="0.0.0.0", port=5000)
    ```
