---
# You can also start simply with 'default'
theme: default
# random image from a curated Unsplash collection by Anthony
# like them? see https://unsplash.com/collections/94734566/slidev
background: ./images/folder.png
# some information about your slides (markdown enabled)
title: Juju Backup and Restore
info: |
  ## Juju Backup and Restore.

# apply unocss classes to the current slide
class: text-center
# https://sli.dev/features/drawing
drawings:
  persist: false
# slide transition: https://sli.dev/guide/animations.html#slide-transitions
transition: slide-left
# enable MDC Syntax: https://sli.dev/features/mdc
mdc: true
# take snapshot for each slide in the overview
overviewSnapshots: true

fonts:
   sans: Ubuntu

lineNumbers: true
---

# Juju Backup and Restore

Erlon R. Cruz | Sustainning Engineering

<div class="abs-br m-6 flex gap-2">
  <button @click="$slidev.nav.openInEditor()" title="Open in Editor" class="text-xl slidev-icon-btn opacity-50 !border-none !hover:text-white">
    <carbon:edit />
  </button>
  <a href="https://github.com/slidevjs/slidev" target="_blank" alt="GitHub" title="Open in GitHub"
    class="text-xl slidev-icon-btn opacity-50 !border-none !hover:text-white">
    <carbon-logo-github />
  </a>
</div>

<!--
The last comment block of each slide will be treated as slide notes. It will be visible and editable in Presenter Mode along with the slide. [Read more in the docs](https://sli.dev/guide/syntax.html#notes)
-->

---
transition: fade-out
layout: center

---

As of today, the Juju controller backup/restore process is partially supported.
And restoring a controller to a different machine is not fully supported.
  
<br>

```bash
[ubuntu@sombrafam-bastion(kvm):~]$ juju help commands | grep backup
create-backup                Create a backup.
download-backup              Download a backup archive file.
```

<br>

* `juju-restore` tool is off-tree and does not support restoring a controller to
a different machine. You can only revert to the same machine (snapshot revert
like).

* A community guide exists but is updated and requires a lot of editing and manual
steps.

* We want something that can be as automated as possible and reliable.

---
layout: center
transition: fade-out
background: ./images/slides.png
class: text-white
---

# Prerequisites

- The recovered (old) controller has a recent backup.
- The user has permissions and resources to bootstrap a new controller in the
  same cloud as the old one.

---
transition: fade-out
---

# 1. Setting up the stage

<br><br>

Back up and shut off old controllers to prevent conflicts. Bootstrap a new
controller with the same Juju version, noting all UUIDs and IPs.

```shell
# bootstraps a new controller
juju bootstrap <cloud>

# displays the required information
juju controllers --format json  | jq
juju models --format json | jq
```

<!--
Boa
-->

---
transition: fade-out
layout: center
---


Ensure essential variables are configured in the shell for consistent environment setup across all systems used.

🛠 **User interaction required**

```shell
# On bastion
BACKUP_FILE_NAME=""

NEW_CONTROLLER_NAME=""
NEW_CONTROLLER_UUID=""
NEW_CONTROLLER_MODEL_UUID=""
NEW_CONTROLLER_INSTANCE_ID=""
NEW_CONTROLLER_IP=""

OLD_CONTROLLER_NAME=""
OLD_CONTROLLER_UUID=""
OLD_CONTROLLER_MODEL_UUID=""
```

---
transition: fade-out
layout: center
---

# 2. Unpack the backup and copy it to the new controller:

<br><br>

```shell
# On bastion
juju model-config -m ${NEW_CONTROLLER_NAME}:controller logging-config='<root>=DEBUG;unit=DEBUG'
rm -rf juju-backup-old && tar -xvf $BACKUP_FILE_NAME && mv juju-backup juju-backup-old
pushd juju-backup-old && tar -xvf root.tar && popd
rsync -av  -e "ssh -i ~/.local/share/juju/ssh/juju_id_rsa" juju-backup-old ubuntu@${NEW_CONTROLLER_IP}:/tmp/
ssh ubuntu@${NEW_CONTROLLER_IP}
```

---
transition: fade-out

---

# 3. Preparing the new controller

<br>

- export all variables into the controller
- `yq` makes easier to edit config files

<br>

````md magic-move
```shell
# Switch to root user to ensure all commands have the necessary permissions
sudo -s

# Export necessary environment variables defined previously (e.g., NEW_CONTROLLER_NAME)
# These variables may be required in subsequent steps
# NEW_CONTROLLER_NAME=
# ...
```

```shell
# Install yq (a YAML processor) using snap, copy the binary to /usr/local/bin, and remove the snap package
sudo snap install yq
sudo cp /snap/yq/current/bin/yq /usr/local/bin/yq
sudo snap remove yq
```

```shell
# Backup existing Juju data directories before making changes
sudo cp -ar /var/lib/juju /var/lib/juju.bak
sudo cp -ar /var/snap/juju-db/common /var/snap/juju-db/common.bak
```

```shell
# Extract necessary configuration values from the backup agent.conf file
apiaddress0=$(sudo yq eval '.apiaddresses[0]' "/var/lib/juju.bak/agents/machine-0/agent.conf")
apiaddress1=$(sudo yq eval '.apiaddresses[1]' "/var/lib/juju.bak/agents/machine-0/agent.conf")
upgraded_to_version=$(sudo yq eval '.upgradedToVersion' "/var/lib/juju.bak/agents/machine-0/agent.conf")
new_dbpass=$(sudo grep statepassword /var/lib/juju.bak/agents/machine-0/agent.conf | cut -d' ' -f2)
```

```shell
# Display the extracted configuration values for verification
echo "apiaddresses: $apiaddress0:$apiaddress1"
echo "upgraded_to_version: $upgraded_to_version"
echo "new dbpass: $new_dbpass"
```

```shell
# Stop Juju services to prepare for restoring from backup
sudo systemctl stop jujud-machine-0.service
sudo snap stop juju-db
```

```shell
# Remove current 'agents' and 'raft' directories and restore them from the backup
cd /var/lib/juju
sudo rm -rf agents raft
sudo cp -r /tmp/juju-backup-old/var/lib/juju/{agents,nonce.txt,server.pem,system-identity} .
```

```shell
# Restore the shared-secret and server.pem files needed by juju-db
sudo cp -r /tmp/juju-backup-old/var/snap/juju-db/common/shared-secret /var/snap/juju-db/common/shared-secret
sudo cp -r /tmp/juju-backup-old/var/lib/juju/server.pem /var/snap/juju-db/common/server.pem
```

```shell
# Create necessary symbolic links in the agents directory for the restored machine
machine_folder=$(ls agents | grep machine)
machine_id=$(echo $machine_folder | cut -d'-' -f2)
pushd agents && sudo ln -s $machine_folder controller-$machine_id && popd
pushd agents && sudo ln -s $machine_folder unit-controller-$machine_id && popd
```

```shell
# In the tools directory, create a symbolic link to the tools for the restored machine
pushd tools
tools_folder=$(find . -mindepth 1 -maxdepth 1 -type d)
sudo ln -s $tools_folder $machine_folder
popd
```

```shell
# Update the agent.conf file with the correct apiaddresses and upgradedToVersion
sudo yq eval ".apiaddresses[0] = \"$apiaddress0\"" -i "agents/$machine_folder/agent.conf"
sudo yq eval ".apiaddresses[1] = \"$apiaddress1\"" -i "agents/$machine_folder/agent.conf"
sudo yq eval ".upgradedToVersion = \"$upgraded_to_version\"" -i "agents/$machine_folder/agent.conf"
```
````

---
transition: fade-out
layout: center
---

We also need to update the service files of the new controller to match those
of the old controller. The service should be named after the old controllers'
master machine number.

```shell
cd /etc/systemd/system
sudo mv jujud-machine-0.service jujud-machine-0.service.bak
sudo mv jujud-machine-0-exec-start.sh jujud-machine-0-exec-start.sh.bak
sudo cp jujud-machine-0.service.bak jujud-$machine_folder.service
sudo cp jujud-machine-0-exec-start.sh.bak jujud-$machine_folder-exec-start.sh
sudo sed -i "s/machine-0/$machine_folder/g" jujud-$machine_folder.service
sudo sed -i "s/machine-0/$machine_folder/g" jujud-$machine_folder-exec-start.sh
sudo sed -i "s/--machine-id 0/--machine-id $machine_id/g" jujud-$machine_folder-exec-start.sh

sudo systemctl daemon-reload
```

---
transition: fade-out
layout: center
---

# 4. Testing database access

<br>

Start MongoDB with the right certificate, update agent.conf for SSL, and test
connection with new credentials.

<br>

```shell
agent="machine-0"
yq eval ".cacert" "/var/lib/juju/agents/$machine_folder/agent.conf" > /var/snap/juju-db/common/ca.pem
sudo snap start juju-db

sudo juju-db.mongo --tlsCAFile /var/snap/juju-db/common/ca.pem --tls -u $agent -p $new_dbpass localhost:37017/admin
```

---
transition: fade-out
layout: center
---

## 5. Restoring the database

<br>

Restore the mongo dump from the backup:

<br>

```shell
rm -rf /var/snap/juju-db/common/juju-backup-old/ && sudo cp -r /tmp/juju-backup-old/ /var/snap/juju-db/common/
sudo juju-db.mongorestore --ssl --sslCAFile /var/snap/juju-db/common/ca.pem \
  -u $agent -p $new_dbpass --authenticationDatabase admin --drop  -h localhost \
  --port 37017 --oplogReplay --batchSize 10 /var/snap/juju-db/common/juju-backup-old/dump/
```

---
transition: fade-out
layout: center
---

## 6. Final steps before database manipulation

<br>

Before we leave the shell, let's make our lives easier by printing the
variables we're going to use in Mongo. Make sure all of them are correct and set
every time you need to re-connect to mongo.

<br>

```shell
echo "var newDbPass = '$new_dbpass'"
echo "var oldDbPass = '$old_dbpass'"
echo "var machineFolder = '$machine_folder'"
echo "var machineId = '$machine_id'"
echo "var newControllerModelUUID = '$NEW_CONTROLLER_MODEL_UUID'"
echo "var newControllerUUID = '$NEW_CONTROLLER_UUID'"
echo "var newControllerInstanceID = '$NEW_CONTROLLER_INSTANCE_ID'"
echo "var newControllerIP = '$NEW_CONTROLLER_IP'"
echo "var newControllerHostname = '`hostname`'"
echo "var oldControllerUUID = '$OLD_CONTROLLER_UUID'"
echo "var oldControllerModelUUID = '$OLD_CONTROLLER_MODEL_UUID'"
```

---
transition: fade-out
---

# 7. Database manipulations

<br>

All database manipulations going forward are based on the variable set before
and doesn't require manual interaction.

**For example:**

````md magic-move

```js
var newDbPass = ''
var oldDbPass = ''
var machineFolder = ''
var machineId = ''
var newModelControllerUUID = ''
var newControllerInstanceID = ''
var newControllerIP = ''
var newControllerHostname = ''
// ...
```

```js

use juju
var machines =  db.machines.find({"jobs": 1})
machines.forEach(function(machine) {
    if(machine.machineid != machineId) {
        _id = machine["model-uuid"] + ":" + machine.machineid
        print("Demoting machine " + _id)
        
        db.machines.update({"_id": _id},
            {$set: {jobs: [1], hasvote: false}})
    }
})
```
````

---
transition: fade-out
layout: center
---

- 7.1. Create the agent's user (machine-3, for example) copy roles
- 7.2. Reconnect to the new database using the new user (delete machine-0)
- 7.3. Fixing peergrouper information
- 7.4. Clean up the IP addresses for the restored agent.
- 7.5. Update the instance-id for the restored controller.

---
transition: fade-out
layout: center
---

## 7.6. Cleanup the ip.addresses collection on the controller machine

<br>

```js {4-10}
var controller = db.machines.find({"jobs": 2})
controller.forEach(function(machine) {
    print("Updating machine addresses")
    db.machines.update({"_id": machine._id}, 
        {$set: {
            "addresses.0.value": newControllerIP,
            "machineaddresses.0.value": newControllerIP,
            "preferredpublicaddress.value": newControllerIP,
            "preferredprivateaddress.value": newControllerIP
    }})
})
// The addresses of the machine should point to the new controller IP
db.machines.find({"jobs": 2}).pretty()

```

---
transition: fade-out
layout: center
---

## 7.7 Cleanup the IP addresses that are not being restored
## 7.8 Cleanup the machines that are not being restored


---
transition: fade-out
---

# 8. Start Juju Services

```shell
sudo systemctl start jujud-$machine_folder.service
```

---
transition: fade-out
layout: center
---

# 9. Update the controller's configuration

<br>

Update the bastion's controller file (.local/share/juju/controllers.yaml) with
the new controllers' api-endpoints address.

<br>

```shell
# On bastion

juju_share='.local/share/juju/controllers.yaml'
apiep0=$(sudo yq eval '.controllers.'$NEW_CONTROLLER_NAME'.api-endpoints[0]' $juju_share)
apiep1=$(sudo yq eval '.controllers.'$NEW_CONTROLLER_NAME'.api-endpoints[1]' $juju_share)

sudo yq eval '.controllers.'$OLD_CONTROLLER_NAME'.api-endpoints[0] "'$apiep0'"' -i $juju_share
sudo yq eval '.controllers.'$OLD_CONTROLLER_NAME'.api-endpoints[1] = "'$apiep1'"' -i $juju_share
```

---
transition: fade-out
---

# 10. Update the controller's IP address in the agents

<br>

Update the controller's IP address in the agents' configuration files. You need
to run this for each model.

<br>
** 🛠 User interaction required **

```shell {*} {maxHeight:'100px'} {maxWidth:'100px'}
# On bastion

model=""
if [ -z "$model" ]; then
  echo "Please set the model variable"
  exit 1
fi

for m in `juju status -m $model --format=json | jq -r '.machines | keys | join("\n")'`; do
  echo "Fixing machine address  for model ${model}" machine-$m
  juju ssh -m $model $m 'cd /var/lib/juju/agents; for a in `ls -d *`; do echo "replacing $a/agent.conf" ; sudo sed -i "s/apiaddresses:/apiaddresses:\n- '$NEW_CONTROLLER_IP':17070/" $a/agent.conf;  done'
  # juju ssh -m $model $m 'cd /var/lib/juju/agents; for a in `ls -d *`; do echo "replacing $a/agent.conf" ; sudo sed -i "s/17070:17070/17070/g" $a/agent.conf;  done'
  juju ssh -m $model $m "sudo systemctl restart jujud-machine-${m}"
done
```


---
transition: fade-out
layout: center
---

# 11. Enable HA

As of now, all your models should be reachable and the agents in the units from
each model in the same status as they were before the backup restore. Make sure
that that is the case. If everything is working as expected, you can enable HA.

```shell
juju enable-ha
```

---
transition: fade-out
layout: center
---

# Needs testing scenarios

1. Test the new controller by deploying a new model and a new application.
2. Test the migration of multiple models and applications.
3. Adding new applications to the model after the restoring process.
4. Deleting the models and applications after the restoring process.
5. Test on Focal
6. Test on 3.5.x
7. LXD deployments

---
transition: fade-out
layout: center
---

# Additional Resources

- [Google Docs Version for Contributing](https://docs.google.com/document/d/1CswvICqSxTVGrIFiFjKhA9WrMciZzYU0Sx7PaZ3yH5I/edit?tab=t.0)
- [Rendered Markdown With the Full Guide](https://gist.github.com/sombrafam/ebb62a37f7ec8af884f27746c9d4fe8b)


---
transition: fade-out
layout: default
---

# Special Thanks

- Alan Baghumian
- Nicolas Bock
- John Meinel & Juju Team
