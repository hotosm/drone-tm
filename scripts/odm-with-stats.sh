#!/bin/bash -e

docker=${DOCKER_ALIAS:-docker}
odm_image=${ODM_IMAGE:-opendronemap/odm}

name=$1
shift
DATASETS=$HOME/datasets
TASKDIR=$DATASETS/$name
mkdir -p $TASKDIR

sleep 0.1
echo
echo "==== Processing task $name with images from $@ ===="
if [ -f $TASKDIR/odm_orthophoto/odm_orthophoto.tif ] && [ -f $TASKDIR/odm_dem/dsm.tif ]; then
    echo "$name/odm_orthophoto and $name/odm_dem already contain outputs; skipping."
    echo
    exit 0
fi

echo
echo "Disk space check:"
df -k /
df -k / > $TASKDIR/df-start-$$.txt

mkdir -p $TASKDIR/images
echo
for s3path in "$@"; do
    echo Fetching images from $s3path/...
    aws s3 sync "$s3path/" $TASKDIR/images --include "*.jpg" --include "*.jpeg" --include "*.JPG" --include "*.JPEG"
done

ls -l $TASKDIR/images > $TASKDIR/images-$$.txt

# Final report generation crashes due to a NumPy version conflict,
# but all the outputs are fine, so we just --skip-report for now.
echo
echo Running ODM on $TASKDIR...
container_name=odm-$$
stats_log=$TASKDIR/cgroup-stats-$$.log

"$docker" run -t -i --rm --name $container_name \
    --user $(id -u):$(id -g) \
    --volume $DATASETS:/datasets \
    "$odm_image" --project-path /datasets $name --dsm --auto-boundary --skip-report \
    2>&1 | tee -a $TASKDIR/odm.log &
docker_pid=$!

# Give Docker a moment to create the container, then find its cgroup.
sleep 5
cid=$("$docker" inspect --format '{{.Id}}' $container_name)
cgroup_dir=/sys/fs/cgroup/system.slice/docker-${cid}.scope
ts=$(date +%FT%T)
echo "($ts) Polling cgroup at $cgroup_dir" >> $stats_log

# Poll while the docker run process is alive. memory.peak is a monotonic
# high-water mark, so the last successful read is our final answer.
while kill -0 $docker_pid 2>/dev/null; do
    if [ -r "$cgroup_dir/memory.peak" ]; then
        ts=$(date +%FT%T)
        memory_peak=$(cat "$cgroup_dir/memory.peak" 2>/dev/null || echo "?")
        memory_current=$(cat "$cgroup_dir/memory.current" 2>/dev/null || echo "?")
        memory_swap_peak=$(cat "$cgroup_dir/memory.swap.peak" 2>/dev/null || echo "?")
        memory_swap_current=$(cat "$cgroup_dir/memory.swap.current" 2>/dev/null || echo "?")
        memory_oom_kill=$(grep '^oom_kill ' "$cgroup_dir/memory.events" 2>/dev/null | sed -e 's/oom_kill *//' || echo "?")
        memory_stat_anon=$(grep '^anon ' "$cgroup_dir/memory.stat" 2>/dev/null | sed -e 's/anon *//' || echo "?")
        memory_stat_file=$(grep '^file ' "$cgroup_dir/memory.stat" 2>/dev/null | sed -e 's/file *//' || echo "?")
        memory_stat_kernel=$(grep '^kernel ' "$cgroup_dir/memory.stat" 2>/dev/null | sed -e 's/kernel *//' || echo "?")
        memory_stat_slab=$(grep '^slab ' "$cgroup_dir/memory.stat" 2>/dev/null | sed -e 's/slab *//' || echo "?")
        cpu_stat_usage_usec=$(grep '^usage_usec ' "$cgroup_dir/cpu.stat" 2>/dev/null | sed -e 's/usage_usec *//' || echo "?")
        cpu_stat_user_usec=$(grep '^user_usec ' "$cgroup_dir/cpu.stat" 2>/dev/null | sed -e 's/user_usec *//' || echo "?")
        cpu_stat_system_usec=$(grep '^system_usec ' "$cgroup_dir/cpu.stat" 2>/dev/null | sed -e 's/system_usec *//' || echo "?")
        echo "$ts memory_peak=$memory_peak memory_current=$memory_current memory_swap_peak=$memory_swap_peak memory_swap_current=$memory_swap_current memory_oom_kill=$memory_oom_kill memory_stat_anon=$memory_stat_anon memory_stat_file=$memory_stat_file memory_stat_kernel=$memory_stat_kernel memory_stat_slab=$memory_stat_slab cpu_stat_usage_usec=$cpu_stat_usage_usec cpu_stat_user_usec=$cpu_stat_user_usec cpu_stat_system_usec=$cpu_stat_system_usec" >> $stats_log
        echo "$memory_peak" > $TASKDIR/memory-peak-$$.txt
        echo "$memory_swap_peak" > $TASKDIR/memory-swap-peak-$$.txt
        cat "$cgroup_dir/cpu.stat" > $TASKDIR/cpu-stat-$$.txt 2>/dev/null || true
    fi
    sleep 10
done
ts=$(date +%FT%T)
echo "($ts) Docker process exited" >> $stats_log

# Reap the backgrounded docker run and capture its exit status.
if wait $docker_pid; then
    df -k / > $TASKDIR/df-finish-$$.txt
    du -k $TASKDIR > $TASKDIR/du-$$.txt

    echo
    echo Cleaning up...
    rm -rf $TASKDIR/images || true
    rm -rf $TASKDIR/opensfm || true
fi
