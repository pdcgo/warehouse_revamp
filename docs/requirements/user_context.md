# User Contexts.

## General.
1. User can be have different role across teams.
```mermaid
block-beta

columns 2

a["Alfred"]

space:1
space:2

cs["Customer Service"]
adm["Admin"]

space:2

s1["Selling Team 1"]
s2["Selling Team 2"]

a-->cs
a-->adm
cs-->s1
adm-->s2

```

## Role That exists across teams.
1. warehouse team.
    - The Owner
    - The Admin
    - The Packer. 

2. selling team.
    - The Owner.
    - The Admin.
    - The Customer Service.

3. admin team.
    - The Owner.
    - The Admin.

4. root team.
    - The Root.
