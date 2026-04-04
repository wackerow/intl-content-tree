## Smart contract example {#smart-contract-example}

Here is a simple Solidity contract:

```solidity
// This is a simple storage contract
// It stores a single number
pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 storedData;

    // Set the stored value
    function set(uint256 x) public {
        storedData = x;
    }

    // Get the stored value
    function get() public view returns (uint256) {
        return storedData;
    }
}
```

And a Python example:

```python
# Connect to a local node
from web3 import Web3

w3 = Web3(Web3.HTTPProvider('http://localhost:8545'))
print(w3.is_connected())
```

## Prose fence example {#prose-fence}

```md
This is translatable prose inside a markdown fence.
It should be treated as content, not code.
```

```text
This is also translatable text inside a text fence.
```
