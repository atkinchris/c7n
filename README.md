# c7n

CLI for Chameleon Ultra.

`c7n` is a contraction of "chameleon", a play on `k8s` for Kubernetes.

## Examples

```sh
# Get basic info on a tag.
$ c7n info
{ uid: 'deadbeef', sak: '08', atqa: '0400' }

# Read a block
$ c7n read 2 A ffffffffffff
00000000000000000000000000000000

# Write a block
$ c7n write 2 A ffffffffffff aaaaaabbbbbbccccccddddddeeeeeeff

# Test an auth key
$ c7n test-key 2 A 000000000000
```
