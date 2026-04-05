---
title: Introduction to Free Software
description: A practical guide to FLOSS licensing and collaboration
image: /images/foss-hero.png
lang: en
---

## What is free software? {#what-is-free-software}

Free software respects users' freedom. The [Free Software Foundation](https://www.fsf.org/) defines four essential freedoms:

- Freedom 0: Run the program for any purpose
- Freedom 1: Study and modify the source code
- Freedom 2: Redistribute copies
- Freedom 3: Distribute modified versions

<InfoBanner title="Important distinction" description="Free as in freedom, not free as in price">

The word "free" in free software refers to liberty, not cost. See the [GNU philosophy](https://www.gnu.org/philosophy/) for details.

</InfoBanner>

## Choosing a license {#choosing-a-license}

### Copyleft licenses {#copyleft}

Copyleft licenses like `GPL-3.0` require derivative works to use the same license. This ensures the software remains free.

```solidity
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract SimpleStorage {
    string public data = "hello";
}
```

### Permissive licenses {#permissive}

Permissive licenses like `MIT` and `Apache-2.0` allow proprietary derivatives.

![License comparison chart](/images/license-comparison.png)

## Community collaboration {#community}

<ExpandableCard title="How to contribute" contentPreview="Getting started with open source" eventCategory="/contribute">

1. Find a project that interests you
2. Read the contributing guidelines
3. Submit a pull request

Check the <a href="https://opensource.guide/">Open Source Guide</a> for detailed instructions.

</ExpandableCard>

<Demo id="abc1234" />

## Further reading {#further-reading}

Visit [choosealicense.com](https://choosealicense.com/) and [SPDX](https://spdx.org/) for more information.
